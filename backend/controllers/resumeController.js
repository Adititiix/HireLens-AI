const axios    = require("axios");
const Resume   = require("../models/Resume");
const {getFileType}=require("../middleware/upload");
// PDF/DOCX → text + hyperlinks (label/value spacing, link annotations, DOCX <a href>) — see utils/documentText.js
const {extractDocument,normalizeLine,safeUrl}=require("../utils/documentText");
const NLP = process.env.NLP_SERVICE_URL||"http://localhost:8000";

// Text only — used where links aren't needed (job-description upload).
async function parseFile(file){ return (await extractDocument(file)).text; }

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}

// ── FIX (requirement #1): recursive deep merge ────────────────────────────
function isPlainObject(v){
  return v!==null && typeof v==="object" && !Array.isArray(v) && !(v instanceof Date);
}
function deepMerge(target, source){
  if(!isPlainObject(target)) target = {};
  const out = {...target};
  for(const key of Object.keys(source||{})){
    const sVal = source[key];
    const tVal = out[key];
    if(isPlainObject(sVal) && isPlainObject(tVal)){
      out[key] = deepMerge(tVal, sVal);
    } else {
      out[key] = sVal;
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// TASK 1: STRUCTURED RESUME EXTRACTION (rewritten)
//
// ROOT CAUSE of the reported bugs:
//   The old parser treated ANY non-bullet line under 100 chars as the start
//   of a brand-new project/experience entry. A line like
//     "TrustVault | Python, FastAPI, JWT, SQLite, AES-256-GCM, X25519 ECDH Aug 2026"
//   became `name` = the entire line (technologies stayed empty), and any
//   short unrelated line elsewhere could spuriously start a phantom new
//   project — this is exactly the "projects merge / split incorrectly"
//   symptom reported.
//
// FIX:
//   A new entry (project or experience) is now only started when a line
//   matches a real title-line SHAPE:
//     "<Name> | <comma, separated, tech, list> [trailing Month Year(s)]"
//   for projects, or
//     "<Title> | <Company> [(Location)] [trailing date range]"
//   for experience. Technologies and dates are extracted into their own
//   fields instead of being left inside `name`/`title`. Any line that does
//   NOT match this shape while an entry is open is treated as a continuation
//   (appended as a bullet if bullet-prefixed, otherwise ignored rather than
//   silently starting a bogus new entry).
// ══════════════════════════════════════════════════════════════════════════

// Expanded section heading recognition (Task: SECTION DETECTION)
const SECTION_HEADINGS = {
  summary:        /^(summary|professional summary|career summary|profile|objective|about me)$/i,
  experience:     /^(experience|work experience|professional experience|relevant experience|employment history|employment|work history|career history|internships?|internship experience|organi[sz]ations?|volunteer(ing| experience| work)|leadership experience|positions? of responsibility)$/i,
  projects:       /^(projects|personal projects|academic projects|key projects|selected projects|technical projects|major projects|project experience|project work|research projects)$/i,
  skills:         /^(skills|technical skills|key skills|core skills|skills summary|technologies|technical expertise|areas of expertise|skills\s*(&|and)\s*(technologies|tools)|tools\s*(&|and)\s*technologies|technology stack|tech stack|technical proficiencies)$/i,
  education:      /^(education|academic background|academic qualifications?|educational qualifications?|education\s*(&|and)\s*training)$/i,
  certifications: /^(certifications?|certificates?|licenses?|credentials)$/i,
  // "Achievements", "Accomplishments", "Awards", "Honors", "Key Achievements",
  // "Achievements & Awards", "Awards and Honors", "Honours / Recognition", …
  achievements:   /^((key|notable|major)\s+)?(achievements?|accomplishments?|awards?|honou?rs?|recognitions?)(\s*(&|and|\/|,)\s*(achievements?|accomplishments?|awards?|honou?rs?|recognitions?))*$/i,
  // Trailing sections with no structured target. Recognising them only ends the
  // previous section, so their lines are no longer absorbed into it (e.g. a
  // closing "Interests" list turning into achievements). Nothing is extracted.
  other:          /^(additional information|additional info|interests|hobbies|hobbies\s*(&|and)\s*interests|extra[- ]?curricular activities|extra[- ]?curriculars?|co[- ]?curricular activities|publications|references|languages known|declaration)$/i,
};

const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
// Matches a trailing date or date-range at the end of a line, e.g. "Aug 2026",
// "Jun 2025 – Dec 2025", "2019 - 2023", "Present".
const TRAILING_DATE_RE = new RegExp(
  `((?:(?:${MONTH})\\.?\\s+)?\\d{4}\\s*(?:[-–—]\\s*(?:(?:(?:${MONTH})\\.?\\s+)?\\d{4}|present))?)\\s*$`, "i"
);

const CONTACT_LINE_RE = /@|linkedin\.com|github\.com|leetcode\.com|hackerrank\.com|https?:\/\/|www\.|^\+?\d[\d\s().-]{7,}\d$/i;

function getHeading(line){
  // Whole-line match only (and short) — a keyword inside a sentence or a skills
  // list ("Projects using React…", "Tools: Git") is never treated as a heading.
  const clean = line.replace(/\s+/g," ").replace(/[:\-–_]+$/,"").trim();
  if(clean.length>45) return null;
  for(const [key, re] of Object.entries(SECTION_HEADINGS)){
    if(re.test(clean)) return key;
  }
  return null;
}

function isBulletLine(l){ return /^[•\-–*▪]\s*/.test(l) || /^\d+\.\s*/.test(l); }
function stripBullet(l){ return l.replace(/^[•\-–*▪]\s*/,"").replace(/^\d+\.\s*/,"").trim(); }

// Does this line look like a genuine "<Title> | <Meta>" entry header?
// Requires a pipe AND (a comma-separated list on the right, OR a trailing
// date) — this is what distinguishes a real title line from an ordinary
// bullet or wrapped sentence that merely happens to be short.
function looksLikeEntryHeader(line){
  if(isBulletLine(line)) return false;
  if(!line.includes("|")) return false;
  const [, meta=""] = line.split(/\|(.*)/s).map(s=>s.trim());
  const hasCommaList = /,/.test(meta);
  const hasDate = TRAILING_DATE_RE.test(meta) && /\d{4}/.test(meta);
  return hasCommaList || hasDate;
}

function splitNameAndMeta(line){
  const idx = line.indexOf("|");
  const name = line.slice(0, idx).trim();
  const meta = line.slice(idx+1).trim();
  const dateMatch = meta.match(TRAILING_DATE_RE);
  const date = (dateMatch && dateMatch[1] && /\d{4}/.test(dateMatch[1])) ? dateMatch[1].trim() : "";
  const rest = date ? meta.slice(0, meta.length - dateMatch[0].length).trim().replace(/[,\s]+$/,"") : meta;
  return { name, rest, date };
}

function parseDateRange(dateStr){
  if(!dateStr) return { startDate:"", endDate:"" };
  const parts = dateStr.split(/[-–—]/).map(s=>s.trim()).filter(Boolean);
  if(parts.length>=2) return { startDate:parts[0], endDate:parts[1] };
  return { startDate:parts[0]||"", endDate:"" };
}

// Tolerates an optional space after the period (PDF extraction sometimes
// yields "B. Tech" instead of "B.Tech" — the old inline pattern required them
// adjacent and silently failed to detect the degree line at all, which cascaded
// into gpa/degree both staying empty since the surrounding if-block never ran).
const DEGREE_RE = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?tech|ph\.?\s?d\.?|bachelor|master|associate|mba|diploma|high school)\b/i;

// Skills-section "Label : item1, item2, item3" line → schema-appropriate bucket.
// Maps into the EXISTING Resume schema buckets (technical/tools/cloud/soft/
// languages/programmingLanguages/frameworks/libraries/databases/developerTools) —
// no new schema fields invented, per "keep the current schema" instruction.
const SKILL_LABEL_MAP = [
  { re: /^(languages?|programming(\s+languages?)?)$/i, bucket: "programmingLanguages" },
  { re: /^(frameworks?|libraries)(\/|\s|$)/i,     bucket: "frameworks" },
  { re: /^databases?$/i,                          bucket: "databases" },
  { re: /^(developer tools|tools)$/i,             bucket: "developerTools" },
  { re: /^cloud$/i,                                bucket: "cloud" },
  { re: /^soft skills?$/i,                        bucket: "soft" },
];

// "a, b; c" → ["a","b","c"] with inner whitespace collapsed.
function splitList(s){
  return s.split(/\s*[,;]\s*|\s+[•|]\s+/).map(x=>x.replace(/\s+/g," ").replace(/\.$/,"").trim()).filter(Boolean);
}

// "Label: a, b" or, from PDFs whose label and values are separate columns,
// "Label<TAB>a, b". Returns the bucket the items went into, or null.
function parseSkillsLine(line, skills){
  const m = line.match(/^([A-Za-z][A-Za-z0-9 /&+.#'-]{1,40}?)\s*(?::|\t)\s*(.+)$/);
  if(!m) return null;
  const [, label, itemsStr] = m;
  const items = splitList(itemsStr.replace(/\t+/g," "));
  if(!items.length) return null;
  const match = SKILL_LABEL_MAP.find(e=>e.re.test(label.trim()));
  const bucket = match ? match.bucket : "technical"; // AI/ML, Core CS, Security, etc. → general bucket (no dedicated field exists)
  skills[bucket] = [...new Set([...(skills[bucket]||[]), ...items])];
  skills.technical = [...new Set([...(skills.technical||[]), ...items])]; // always keep the flat legacy list in sync
  return bucket;
}

// ── Achievements ───────────────────────────────────────────────────────────
// Supported shapes (any mix within the section):
//   "Best Project Award | 2023"        + following description line(s) or bullets
//   "Best Project Award — 2023" / ", 2023" / "(2023)" / "Mar 2023"
//   "• Won first place in …"            (each bullet = one achievement)
//   "• Best Paper Award: recognised for …"  (title: description)
// Years are restricted to 1950–2099 so numbers like "Rank 1500" aren't read as dates.
const ACH_YEAR = "(?:19[5-9]\\d|20\\d{2})";
const ACH_DATE_CORE = `(?:(?:${MONTH})\\.?\\s+)?${ACH_YEAR}(?:\\s*[-–—]\\s*(?:(?:(?:${MONTH})\\.?\\s+)?${ACH_YEAR}|present))?`;
const ACH_DATE_ONLY_RE  = new RegExp(`^\\(?${ACH_DATE_CORE}\\)?$`, "i");
const ACH_TITLE_DATE_RE = new RegExp(`^(.+?)\\s*[|—–\\-,:]?\\s*\\(?(${ACH_DATE_CORE})\\)?\\s*$`, "i");
// Wider bullet set than isBulletLine — PDFs/Word often emit ●, ➢, ✓ or private-use glyphs.
const ACH_BULLET_RE = /^[•\-–*▪●○■□◦►▸➢➤✓✔→\uf0a7\uf0b7\uf076\uf0d8]\s*|^\d+[.)]\s+/;

function splitAchievementLine(text){
  let title = text, date = "", extra = "";
  if(text.includes("|")){
    const parts = text.split("|").map(s=>s.trim()).filter(Boolean);
    title = parts.shift() || "";
    const last = parts[parts.length-1];
    if(last && ACH_DATE_ONLY_RE.test(last)) date = parts.pop().replace(/[()]/g,"");
    else if(last){
      const m = last.match(ACH_TITLE_DATE_RE);
      if(m){ parts[parts.length-1] = m[1].trim(); date = m[2].trim(); }
    }
    extra = parts.join(" | ");                 // e.g. issuer / organisation
  } else {
    const m = text.match(ACH_TITLE_DATE_RE);
    if(m && m[1].replace(/[\s|—–\-,:(]+$/,"").length >= 3){
      title = m[1].replace(/[\s|—–\-,:(]+$/,"").trim();
      date = m[2].trim();
    }
  }
  if(!extra){
    // "Best Paper Award: recognised for …" / "Hackathon Winner – built …"
    const sep = title.match(/^(.{3,60}?)\s*(?::|\s[—–-]\s)\s*(.{3,})$/);
    if(sep){ title = sep[1].trim(); extra = sep[2].trim(); }
  }
  return { title: title.trim(), date, extra };
}

const endsSentence = s => /[.!?)]$/.test((s||"").trim());
// Separate a new description line from what's already there ("Ministry of Education — Selected among …").
const joinDescription = (desc, line) => !desc ? line : desc + (endsSentence(desc) ? " " : " — ") + line;
const isTitleLike  = s => s.length<=70 && /^[A-Z0-9"'(]/.test(s) && !/[.!?]$/.test(s);

// ── Line / link helpers for parseResumeText ────────────────────────────────
// Lines arrive normalized (utils/documentText.normalizeLine): a TAB marks a
// column break in the source PDF/DOCX (label → value, title → right-aligned date,
// company → location). `flat` turns a line back into prose for storing.
const flat    = l => l.replace(/\t+/g," ").replace(/ {2,}/g," ").trim();
const columns = l => l.split("\t").map(s=>s.trim()).filter(Boolean);

// One date: "Aug 2023", "December 1, 2023", "06/2025", "2023".
const DATE_TOKEN = `(?:(?:${MONTH})\\.?\\s+(?:\\d{1,2},?\\s+)?\\d{4}|\\d{1,2}[\\/.]\\d{4}|\\d{4})`;
// A date or range standing alone (own column or own line), optionally in [ ] or ( ).
const DATE_ONLY_RE = new RegExp(`^[\\[(]?${DATE_TOKEN}(?:\\s*(?:[-–—]+|to)\\s*(?:${DATE_TOKEN}|present|current|now|ongoing))?[\\])]?$|^[\\[(]?(present|current)[\\])]?$`, "i");
const isDateLine = l => DATE_ONLY_RE.test(l.trim());
const cleanDate = d => d.replace(/^[\[(]|[\])]$/g,"").trim();
// "Bengaluru, India", "Chennai, TN", "(Remote)", "Hybrid"
const LOCATION_RE = /^\(?(remote|hybrid|on-?site)\)?$|^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+(\s*\((remote|hybrid)\))?$/i;
// Common certification issuers — decides which side of "A - B" is the provider.
const CERT_PROVIDER_RE = /^(udemy|coursera|edx|deloitte|aws|amazon web services|google|google cloud|microsoft|ibm|oracle|nptel|linkedin learning|hackerrank|forage|cisco|meta|infosys springboard|great learning|simplilearn|datacamp|kaggle|freecodecamp|salesforce|red hat)$/i;
const MONTH_OR_RANGE_RE = new RegExp(`\\b(?:${MONTH})\\b|[-–—]`, "i");
const INSTITUTION_RE = /\b(universit(y|ies)|institute|college|school|academy|polytechnic|iit|nit|iiit)\b/i;
const GPA_RE   = /\b(?:c?gpa|cpi)\s*[:\-]?\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/i;
const EMAIL_RE = /[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+/;
const URL_IN_TEXT_RE = /\b(?:https?:\/\/|www\.)[^\s,;)<>"]+|\b(?:github\.com|gitlab\.com|linkedin\.com|leetcode\.com|hackerrank\.com)\/[^\s,;)<>"]+/gi;
const TECH_LINE_RE = /^(?:tech(?:nologies|nology)?(?:\s*stack)?|stack|tools(?:\s*used)?|built\s+with)\s*[:\-–]\s*(.+)$/i;
const LINK_LABEL_RE = /^(?:github|gitlab|repo(?:sitory)?|code|source(?:\s*code)?|live(?:\s*demo)?|demo|website|link|url|app)s?\s*[:\-–]?\s*/i;

// PDF line-wrap: undo hyphenation ("documen-" + "tation"), otherwise join with a space.
function joinWrapped(prev, next){
  if(/[a-z]-$/.test(prev) && /^[a-z]/.test(next)) return prev.slice(0,-1) + next;
  return `${prev} ${next}`;
}
// Is `line` the wrapped continuation of `prev` (rather than a new item)?
const continues = (prev, line) => !!prev && (/^[a-z(&]/.test(line) || !/[.!?;:)]$/.test(prev.trim()));
const lastOf = s => (s||"").split("\n").pop();

const textUrls = s => [...s.matchAll(URL_IN_TEXT_RE)].map(m => m[0].replace(/[.)\]]+$/,""));
function hostOf(u){
  try{ return new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./,""); }
  catch{ return ""; }
}
function linkKind(url){
  if(/^mailto:/i.test(url)) return "email";
  const h = hostOf(url);
  for(const k of ["linkedin","github","leetcode","hackerrank"]) if(h===`${k}.com` || h.endsWith(`.${k}.com`)) return k;
  return "other";
}
// Does the line consist only of link text / URLs (e.g. "GitHub | Live Demo", "github.com/u/repo")?
function isLinkOnly(line, links){
  if(!links.length) return false;
  let rest = line.replace(URL_IN_TEXT_RE," ");
  // Only short, label-like anchor text ("GitHub", "Live Demo") counts as "just a link" — a whole
  // sentence that happens to be hyperlinked is content and must be kept.
  for(const l of links) if(l.text && l.text.length<=25) rest = rest.split(l.text).join(" ");
  return rest.replace(LINK_LABEL_RE,"").replace(/[\s|,⋄•·:\-–]+/g,"").length===0;
}
// A repeated footer / contact line in the middle of the document (nothing but email/phone/URLs).
function isContactNoise(line){
  if(!CONTACT_LINE_RE.test(line)) return false;
  const rest = line.replace(URL_IN_TEXT_RE,"").replace(new RegExp(EMAIL_RE.source,"g"),"")
    .replace(/\+?\d[\d\s().-]{7,}\d/g,"").replace(/[\s|⋄•·,:\-–]+/g,"");
  return rest.length < 12;
}

// Title/date line of an experience, project, education or certification entry:
//   "Title | meta | date"   (pipe style — the original behaviour)
//   "Title<TAB>Jun 2025 – Dec 2025"   (date in its own column)
//   "Title  Mar 2026"   (trailing month/range date, title-like start)
function parseEntryHeader(line){
  if(isBulletLine(line)) return null;
  const fl = flat(line);
  if(looksLikeEntryHeader(fl)){
    const { name, rest, date } = splitNameAndMeta(fl);
    return { title:name, meta:rest, date, pipe:true };
  }
  const cols = columns(line);
  if(cols.length>=2 && DATE_ONLY_RE.test(cols[cols.length-1])){
    return { title:cols.slice(0,-1).join(" — "), meta:"", date:cleanDate(cols[cols.length-1]), pipe:false };
  }
  const m = fl.match(TRAILING_DATE_RE);
  if(m && /\d{4}/.test(m[1]) && MONTH_OR_RANGE_RE.test(m[1]) && /^[A-Z0-9]/.test(fl) && fl.length<=110 && !/[.!?]$/.test(fl)){
    const title = fl.slice(0, fl.length-m[0].length).replace(/[\s|—–\-,:(]+$/,"").trim();
    if(title.length>=3) return { title, meta:"", date:m[1].trim(), pipe:false };
  }
  return null;
}

function parseResumeText(text, { links = [] } = {}){
  const lines = text.split("\n").map(normalizeLine).filter(Boolean);

  // Hyperlinks (PDF annotations / DOCX <a href>) grouped by the line they sit on.
  const linksByLine = new Map(), unplaced = [];
  for(const l of links){
    const url = safeUrl(l && l.url);
    if(!url) continue;
    const link = { url, text:(l.text||"").trim() };
    const key = normalizeLine(l.line||"");
    if(!key){ unplaced.push(link); continue; }
    if(!linksByLine.has(key)) linksByLine.set(key, []);
    linksByLine.get(key).push(link);
  }
  const takeLinks = line => { const ls = linksByLine.get(line) || []; linksByLine.delete(line); return ls; };
  const linksOn = line => [...takeLinks(line), ...textUrls(line).map(url=>({ url, text:"" }))];

  // ── Header / contact block: everything above the first section heading ──
  const firstHeading = lines.findIndex(l=>getHeading(l)!==null);
  const headerLines = firstHeading===-1 ? lines.slice(0,6) : lines.slice(0, firstHeading);
  const headerText = headerLines.join("\n");
  const contact = { email:"", phone:"", location:"", linkedin:"", github:"", portfolio:"", leetcode:"", hackerrank:"", otherLinks:[] };
  const seen = new Set();
  const applyContactLink = ({ url, text: label }) => {
    const key = url.replace(/^https?:\/\/(www\.)?/i,"").replace(/\/+$/,"").toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    const kind = linkKind(url);
    if(kind==="email"){ if(!contact.email) contact.email = url.replace(/^mailto:/i,"").split("?")[0]; return; }
    if(kind!=="other"){ if(!contact[kind]) contact[kind] = url; return; }
    if(!contact.portfolio) contact.portfolio = url;
    else contact.otherLinks.push({ label: label || hostOf(url), url });
  };
  // Annotation/href targets first (they carry the real URL behind text like "LinkedIn"),
  // then URLs written out in the header text.
  for(const l of headerLines) takeLinks(l).forEach(applyContactLink);
  unplaced.filter(l=>linkKind(l.url)!=="other").forEach(applyContactLink);
  for(const l of headerLines) textUrls(l).forEach(url=>applyContactLink({ url, text:"" }));

  const emailMatch = headerText.match(EMAIL_RE) || text.match(EMAIL_RE);
  if(emailMatch) contact.email = emailMatch[0];
  const phoneMatch = (headerText.match(/\+?\d[\d\s\-()]{7,}\d/) || text.match(/\+?\d[\d\s\-()]{7,}\d/));
  if(phoneMatch) contact.phone = phoneMatch[0].trim();
  for(const l of headerLines){
    const loc = l.split(/[⋄|•·\t]/).map(s=>s.trim()).find(p => /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+(\s+\d{3,6})?$/.test(p) && p.length<=40);
    if(loc){ contact.location = loc; break; }
  }
  // Text-only fallbacks (no protocol in the source text, so none is added).
  const textProfile = re => (text.match(re)||[])[0] || "";
  contact.linkedin   = contact.linkedin   || textProfile(/linkedin\.com\/[\w\-\/]+/i);
  contact.github     = contact.github     || textProfile(/github\.com\/[\w\-]+/i);
  contact.leetcode   = contact.leetcode   || textProfile(/leetcode\.com\/[\w\-\/]+/i);
  contact.hackerrank = contact.hackerrank || textProfile(/hackerrank\.com\/[\w\-\/]+/i);

  const nameLine = lines.map(flat).find(l =>
    l.length>2 && l.length<60 && !CONTACT_LINE_RE.test(l) && getHeading(l)===null
  );

  const skills = { programmingLanguages:[], frameworks:[], libraries:[], databases:[], cloud:[], developerTools:[], soft:[], technical:[], tools:[], languages:[] };
  const exp = [], edu = [], projs = [], certs = [], achs = [];
  let curExp=null, curEdu=null, curProj=null, curAch=null, pendingOrg=null;
  let lastSkillBucket=null, skillLineOpen=false, prevSkillLine="";

  const newExp = (h={}) => {
    const { startDate, endDate } = parseDateRange(h.date);
    return { id:uid(), title:h.title||"", company:h.meta||"", location:"", startDate, endDate,
      current:/present|current|now/i.test(endDate), description:"", bullets:[] };
  };
  const pushExp = () => {
    if(curExp && (curExp.title || curExp.company || curExp.bullets.length)) exp.push(curExp);
    curExp = null;
  };
  const flushPendingOrg = () => {
    // An organisation line that was never followed by its title line — keep it rather than drop it.
    if(pendingOrg){ exp.push({ ...newExp(), company:pendingOrg.name, location:pendingOrg.location }); pendingOrg=null; }
  };
  const newProj = (h={}) => ({ id:uid(), name:h.title||"", description:"", date:h.date||"",
    technologies: h.pipe && h.meta ? h.meta.split(",").map(s=>s.trim()).filter(Boolean) : [],
    githubUrl:"", liveDemoUrl:"", additionalUrl:"" });
  const pushProj = () => {
    if(curProj && (curProj.name || curProj.description)) projs.push({ ...curProj, description:curProj.description.trim() });
    curProj = null;
  };
  const attachProjectLink = (p, { url, text: label }) => {
    if([p.githubUrl, p.liveDemoUrl, p.additionalUrl].includes(url)) return;
    if(linkKind(url)==="github" && !p.githubUrl) p.githubUrl = url;
    else if(!p.liveDemoUrl && (/demo|live|app|website|deploy/i.test(label) || linkKind(url)==="other")) p.liveDemoUrl = url;
    else if(!p.additionalUrl) p.additionalUrl = url;
  };
  const newEdu = () => ({ id:uid(), degree:"", institution:"", location:"", startDate:"", endDate:"", gpa:"", honors:"" });
  const pushEdu = () => { if(curEdu && (curEdu.degree || curEdu.institution)) edu.push(curEdu); curEdu = null; };
  // _kind: "header" = title line (pipe/date/short title) whose following lines describe it;
  //        "bullet" = self-contained achievement sentence.
  const pushAch = () => {
    if(curAch && curAch.title){
      const { _kind, _issuer, ...a } = curAch;
      achs.push({ ...a, title:a.title.trim(), description:a.description.trim() });
    }
    curAch = null;
  };

  let section = null;

  for(const line of lines){
    const heading = getHeading(line);
    if(heading){
      pushExp(); flushPendingOrg(); pushEdu(); pushProj(); pushAch();
      section = heading; lastSkillBucket = null; skillLineOpen = false; prevSkillLine = "";
      continue;
    }
    if(section===null) continue; // header block handled above
    const fl = flat(line);

    if(section==="projects"){
      const lineLinks = linksOn(line);
      const bullet = isBulletLine(line);
      const body = bullet ? flat(stripBullet(line)) : fl;
      const hdr = bullet ? null : parseEntryHeader(line);
      const techM = body.match(TECH_LINE_RE);
      const prev = curProj ? lastOf(curProj.description) : "";
      if(hdr){
        pushProj(); curProj = newProj(hdr);
      } else if(isLinkOnly(body, lineLinks)){
        if(!curProj) curProj = newProj();
      } else if(techM && curProj && !curProj.technologies.length){
        curProj.technologies = splitList(techM[1]);
      } else if(bullet){
        if(!curProj) curProj = newProj();
        curProj.description += (curProj.description ? "\n" : "") + body;
      } else if(curProj && curProj.description && continues(prev, fl)){
        curProj.description = curProj.description.slice(0, curProj.description.length-prev.length) + joinWrapped(prev, fl);
      } else if(isTitleLike(fl) && fl.length<=90 && (!curProj || curProj.description)){
        pushProj(); curProj = newProj({ title:fl }); // project title without a date
      } else {
        if(!curProj) curProj = newProj();
        curProj.description += (curProj.description ? "\n" : "") + fl;
      }
      if(curProj) lineLinks.forEach(l=>attachProjectLink(curProj, l));
      continue;
    }

    if(section==="certifications"){
      const lineLinks = linksOn(line);
      const body = isBulletLine(line) ? flat(stripBullet(line)) : fl;
      if(isLinkOnly(body, lineLinks)){
        if(certs.length && !certs[certs.length-1].credentialUrl) certs[certs.length-1].credentialUrl = lineLinks[0].url;
        continue;
      }
      const lastCert = certs[certs.length-1];
      if(lastCert && isDateLine(body)){ if(!lastCert.issueDate) lastCert.issueDate = cleanDate(body); continue; }
      // Wrapped name (narrow columns): lower-case start, or the previous line ends on a connector word.
      if(lastCert && !lastCert.issueDate && (/^[a-z]/.test(body) || /(\b(in|to|of|with|for|and|from|on|the)|[&:,\-–])$/i.test(lastCert._raw))){
        lastCert._raw = joinWrapped(lastCert._raw, body); continue;
      }
      if(body.length<=3) continue;
      const hdr = parseEntryHeader(line);
      let name = body.replace(URL_IN_TEXT_RE,"").replace(/\s{2,}/g," ").trim(), issueDate = "", provider = "";
      if(hdr){ name = hdr.title; issueDate = hdr.date; provider = hdr.pipe ? hdr.meta : ""; }
      else { const yr = name.match(/\b(?:19|20)\d{2}\b/); if(yr){ issueDate = yr[0]; name = name.replace(yr[0],"").replace(/[\s|—–\-,:(]+$/,"").trim(); } }
      certs.push({ id:uid(), name, provider, issueDate, credentialId:"", credentialUrl: lineLinks[0] ? lineLinks[0].url : "", _raw:name });
      continue;
    }

    takeLinks(line); // links in other sections have no field to go into
    if(isContactNoise(fl)) continue; // repeated footer/contact line mid-document

    if(section==="experience"){
      const hdr = parseEntryHeader(line);
      const cols = columns(line);
      const lastBullet = curExp ? curExp.bullets[curExp.bullets.length-1] : "";
      if(hdr){
        pushExp();
        curExp = newExp(hdr);
        if(pendingOrg){ if(!curExp.company) curExp.company = pendingOrg.name; curExp.location = pendingOrg.location; pendingOrg = null; }
      } else if(isDateLine(fl) && (curExp || pendingOrg)){
        // Date range on its own line (stacked / two-column layouts).
        if(!curExp){ curExp = newExp({ title:"", meta:pendingOrg.name }); curExp.location = pendingOrg.location; pendingOrg = null; }
        if(!curExp.startDate){ const { startDate, endDate } = parseDateRange(cleanDate(fl).replace(/\s+to\s+/i," – ")); curExp.startDate = startDate; curExp.endDate = endDate; curExp.current = /present|current|now/i.test(endDate); }
        else curExp.bullets.push(fl);
      } else if(curExp && LOCATION_RE.test(fl) && cols.length===1){
        curExp.location = curExp.location ? `${curExp.location} ${fl}` : fl;
      } else if(pendingOrg && isTitleLike(fl) && fl.length<=60 && cols.length===1){
        // "Briddlee" then "FULL STACK DEVELOPER INTERN": organisation line + role line → one entry.
        pushExp();
        curExp = newExp({ title:fl, meta:pendingOrg.name }); curExp.location = pendingOrg.location; pendingOrg = null;
      } else if(isBulletLine(line)){
        if(!curExp){ curExp = newExp(); if(pendingOrg){ curExp.company = pendingOrg.name; curExp.location = pendingOrg.location; pendingOrg = null; } }
        curExp.bullets.push(flat(stripBullet(line)));
      } else if(curExp && lastBullet && cols.length<2 && continues(lastBullet, fl)){
        curExp.bullets[curExp.bullets.length-1] = joinWrapped(lastBullet, fl);
      } else if(curExp && !curExp.bullets.length && !curExp.company && fl.length<80){
        // Line right after the title: "Company<TAB>Location" (or just the company).
        curExp.company = cols[0]; curExp.location = cols.slice(1).join(", ");
      } else if(cols.length>=2 || (isTitleLike(fl) && fl.length<=60)){
        flushPendingOrg();
        pendingOrg = { name:cols[0], location:cols.slice(1).join(", ") }; // company-first layouts: the title line follows
      } else if(curExp){
        curExp.bullets.push(fl); // un-bulleted description text
      }
    } else if(section==="education"){
      const hdr = parseEntryHeader(line);
      const gpaM = fl.match(GPA_RE);
      const isDegree = DEGREE_RE.test(fl);
      // A bare trailing year ("… College 2019") — the old parser's date trigger, kept.
      const yearM = !hdr && fl.match(TRAILING_DATE_RE);
      const date = hdr ? hdr.date : (yearM && /\d{4}/.test(yearM[1]) ? yearM[1].trim() : "");
      if(isDegree || hdr || (date && INSTITUTION_RE.test(fl))){
        const main = (hdr ? hdr.title : fl.replace(TRAILING_DATE_RE,"")).replace(GPA_RE,"").replace(/[\s|,;:—–-]+$/,"").trim();
        // Same entry when the institution line came first and this is its degree line (or vice versa).
        const sameEntry = curEdu && ((isDegree && !curEdu.degree) || (!isDegree && !curEdu.institution && curEdu.degree && !curEdu.startDate));
        if(!sameEntry){ pushEdu(); curEdu = newEdu(); }
        if(date){ const { startDate, endDate } = parseDateRange(date); curEdu.startDate = startDate; curEdu.endDate = endDate; }
        if(isDegree){
          // "B.Tech in CSE, SRM Institute of …" → degree + institution
          const split = main.match(/^(.+?)(?:\s*,\s*|\s+[—–|-]\s+|\s+at\s+)(.+)$/);
          if(split && INSTITUTION_RE.test(split[2]) && !INSTITUTION_RE.test(split[1])){ curEdu.degree = split[1].trim(); curEdu.institution = curEdu.institution || split[2].trim(); }
          else curEdu.degree = main;
        } else {
          curEdu.institution = main;
        }
        if(gpaM) curEdu.gpa = gpaM[1].replace(/\s+/g,"");
      } else if(gpaM){
        if(!curEdu) curEdu = newEdu();
        curEdu.gpa = gpaM[1].replace(/\s+/g,"");
        const restOfLine = fl.replace(GPA_RE,"").replace(/^[\s|,;:—–-]+|[\s|,;:—–-]+$/g,"");
        if(restOfLine) curEdu.honors = curEdu.honors ? `${curEdu.honors}\n${restOfLine}` : restOfLine;
      } else if(curEdu && isDateLine(fl)){
        if(!curEdu.startDate && !curEdu.endDate){ const { startDate, endDate } = parseDateRange(cleanDate(fl).replace(/\s+to\s+/i," – ")); if(endDate){ curEdu.startDate = startDate; curEdu.endDate = endDate; } else curEdu.endDate = startDate; }
        else curEdu.honors = curEdu.honors ? `${curEdu.honors}\n${fl}` : fl;
      } else if(INSTITUTION_RE.test(fl) && !fl.includes(":") && (!curEdu || !curEdu.institution || curEdu.degree)){
        // Institution line: completes the current entry, or starts the next school.
        if(curEdu && curEdu.institution){ pushEdu(); }
        if(!curEdu) curEdu = newEdu();
        const cols = columns(line);
        curEdu.institution = cols[0]; if(cols.length>1) curEdu.location = cols.slice(1).join(", ");
      } else if(curEdu && !curEdu.location && columns(line).length===1 && fl.length<=40 && (LOCATION_RE.test(fl) || /^[A-Z][a-z]{3,}$/.test(fl))){
        curEdu.location = fl; // "Kattankulathur" / "Chennai, India"
      } else if(curEdu){
        // Coursework, honours, activities… → the entry's description, wrapped lines re-joined.
        const body = isBulletLine(line) ? flat(stripBullet(line)) : fl;
        const prev = lastOf(curEdu.honors);
        if(curEdu.honors && !isBulletLine(line) && continues(prev, body)) curEdu.honors = curEdu.honors.slice(0, curEdu.honors.length-prev.length) + joinWrapped(prev, body);
        else curEdu.honors = curEdu.honors ? `${curEdu.honors}\n${body}` : body;
      }
    } else if(section==="achievements"){
      const rawLine = fl;
      const bullet = ACH_BULLET_RE.test(rawLine);
      const text = bullet ? rawLine.replace(ACH_BULLET_RE,"").trim() : rawLine;
      if(!text) continue;
      const hasPipe = text.includes("|");
      const { title, date, extra } = splitAchievementLine(text);

      // PDF line-wrap: a plain line continuing the previous achievement's text.
      // (Under a title line, a new dated title like "Dean's List (2022)" still starts a new entry.)
      if(!bullet && curAch && !hasPipe && (curAch._kind==="bullet" || curAch.description)){
        const prev = curAch.description || curAch.title;
        const startsLower = /^[a-z]/.test(text);
        const newDatedTitle = curAch._kind==="header" && date && isTitleLike(title);
        if(startsLower || (!endsSentence(prev) && !newDatedTitle)){
          if(curAch.description===curAch._issuer) curAch.description = joinDescription(curAch.description, text); // issuer from "Title | Issuer | Year" is not a wrapped sentence
          else if(curAch.description) curAch.description += " " + text;
          else {
            // Re-split the joined sentence so a date / "Title: description" at the end of the wrap is still picked up.
            const joined = splitAchievementLine(curAch.title + " " + text);
            curAch.title = joined.title;
            curAch.date = curAch.date || joined.date;
            curAch.description = joined.extra;
          }
          continue;
        }
      }
      if(bullet){
        // Bullets under a title line describe it; otherwise each bullet is its own achievement.
        if(curAch && curAch._kind==="header"){ curAch.description = joinDescription(curAch.description, text); continue; }
        pushAch();
        curAch = { id:uid(), title, description:extra, date, _kind:"bullet" };
      } else if(hasPipe || date || isTitleLike(text)){
        pushAch();
        curAch = { id:uid(), title, description:extra, date, _kind:"header", _issuer:extra||null };
      } else if(curAch && curAch._kind==="header"){
        curAch.description = joinDescription(curAch.description, text);   // description paragraph under a title line
      } else {
        pushAch();
        curAch = { id:uid(), title, description:extra, date, _kind:"bullet" };
      }
    } else if(section==="skills"){
      const body = isBulletLine(line) ? stripBullet(line) : line;
      // Sub-heading inside the skills block ("LANGUAGES", "Tools") — an explicit list, so acronyms like SQL/AWS are kept.
      if(/^(programming\s+)?(languages|tools|frameworks|libraries|technologies|databases|platforms|cloud|soft skills|technical skills|others?)$/i.test(flat(body))) { skillLineOpen = false; prevSkillLine = ""; continue; }
      // Narrow-column wrap: a short bare line continuing the previous one ("Problem-" / "Solving",
      // "User-Centered" / "Design", "Machine" / "Learning, Natural Language").
      const isLabel = /^([A-Za-z][A-Za-z0-9 /&+.#'-]{1,40}?)\s*(?::|\t)\s*\S/.test(body);
      if(!isLabel && prevSkillLine && !/[,.]$/.test(prevSkillLine) && (prevSkillLine.length>=20 || /-$/.test(prevSkillLine)) && flat(body).length<=40){
        const next = flat(body);
        const joined = /[a-z]-$/.test(prevSkillLine) && /^[a-z]/.test(next) ? prevSkillLine.slice(0,-1)+next
          : /-$/.test(prevSkillLine) ? prevSkillLine+next : `${prevSkillLine} ${next}`;
        // Replace the previous line's cut-off last item with the re-joined item(s).
        const prevItems = splitList(prevSkillLine.replace(/^[^:\t]*[:\t]\s*/,""));
        const tail = prevItems[prevItems.length-1];
        const fixedTail = splitList(joined.replace(/^[^:\t]*[:\t]\s*/,"")).slice(prevItems.length-1);
        for(const b of Object.keys(skills)){ const i = skills[b].lastIndexOf(tail); if(i!==-1) skills[b].splice(i,1, ...fixedTail.filter(x=>!skills[b].includes(x))); }
        prevSkillLine = joined; skillLineOpen = /,$/.test(joined);
        continue;
      }
      prevSkillLine = flat(body);
      const bucket = parseSkillsLine(body, skills);
      if(bucket){ lastSkillBucket = bucket; }
      else {
        // Bare comma-separated line — possibly the wrapped continuation of the previous "Label: …" line.
        const items = splitList(flat(body));
        if(items.length){
          skills.technical = [...new Set([...skills.technical, ...items])];
          if(skillLineOpen && lastSkillBucket && lastSkillBucket!=="technical") skills[lastSkillBucket] = [...new Set([...skills[lastSkillBucket], ...items])];
        }
      }
      skillLineOpen = /,$/.test(flat(body));
    }
  }
  pushExp(); flushPendingOrg(); pushEdu(); pushProj(); pushAch();
  for(const c of certs){
    let name = c._raw.replace(/\s{2,}/g," ").trim();
    delete c._raw;
    if(!c.provider){
      // "Name — Provider" or "Provider - Name": a known issuer decides which side is which.
      const m = name.match(/^(.+?)\s*(?:\||[—–]|-)\s+(.+)$/);
      if(m){
        const [l, r] = [m[1].trim(), m[2].trim()];
        if(CERT_PROVIDER_RE.test(l) && !CERT_PROVIDER_RE.test(r)){ c.provider = l; name = r; }
        else if(/\s[—–|-]\s/.test(name) || CERT_PROVIDER_RE.test(r)){ c.provider = r; name = l; }
      }
    }
    c.name = name;
  }

  // Fallback keyword scan (kept from original implementation) in case Skills
  // section wasn't headed clearly, or to backstop the NLP-extracted list.
  const SKILL_KW=["python","javascript","typescript","java","react","node.js","aws","docker",
    "kubernetes","mongodb","postgresql","mysql","redis","git","agile","rest api","graphql",
    "machine learning","deep learning","tensorflow","pytorch","css","html","linux","sql","ci/cd"];
  const tl=text.toLowerCase();
  const kwFound = SKILL_KW.filter(s=>new RegExp("\\b"+s.replace(/\./g,"\\.")+"\\b").test(tl));
  skills.technical = [...new Set([...skills.technical, ...kwFound])];
  if(!skills.programmingLanguages.length) skills.programmingLanguages = kwFound;

  const summaryStart = lines.findIndex(l=>getHeading(l)==="summary");
  let summary = "";
  if(summaryStart!==-1){
    for(let i=summaryStart+1;i<lines.length;i++){
      if(getHeading(lines[i])) break;
      const l = flat(isBulletLine(lines[i]) ? stripBullet(lines[i]) : lines[i]);
      summary = summary ? joinWrapped(summary, l) : l;
    }
  }

  return {
    name:nameLine||"", email:contact.email, phone:contact.phone,
    location:contact.location, linkedin:contact.linkedin, github:contact.github,
    portfolio:contact.portfolio, leetcode:contact.leetcode, hackerrank:contact.hackerrank, otherLinks:contact.otherLinks,
    summary,
    skills,
    experience:exp, education:edu, projects:projs, certifications:certs, achievements:achs, additionalInfo:"",
  };
}

exports.uploadResume=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const {text,links}=await extractDocument(req.file);
    let structured={resume_skills:[],jd_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){console.warn("[resumeController] NLP /extract failed:",e.message);}
    const parsed=parseResumeText(text,{links});
    const nlpSkills=structured.resume_skills||[];
    parsed.skills.technical=[...new Set([...parsed.skills.technical,...nlpSkills])];
    parsed.skills.programmingLanguages=[...new Set([...parsed.skills.programmingLanguages,...nlpSkills])];
    console.log("\n[ResumeUpload] Extracted Skills:");console.log(parsed.skills.technical);
    console.log(`[ResumeUpload] Structured: ${parsed.experience.length} experience, ${parsed.projects.length} projects, ${parsed.education.length} education, ${parsed.achievements.length} achievements, ${links.length} hyperlinks`);
    let doc=null;
    if(req.user){
      doc=await Resume.create({
        userId:req.user._id,rawText:text,parsedData:parsed,
        extractedKeywords:structured.resume_skills||[],
        fileName:req.file.originalname,fileType:getFileType(req.file.mimetype),
      });
    }
    res.json({success:true,text,structured,parsedData:parsed,resumeId:doc?._id||null,_id:doc?._id||null,resume:doc});
  }catch(err){next(err);}
};

exports.uploadResumeAnon=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const {text,links}=await extractDocument(req.file);
    let structured={resume_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){}
    const parsed=parseResumeText(text,{links});
    const nlpSkills=structured.resume_skills||[];
    parsed.skills.technical=[...new Set([...parsed.skills.technical,...nlpSkills])];
    parsed.skills.programmingLanguages=[...new Set([...parsed.skills.programmingLanguages,...nlpSkills])];
    res.json({success:true,text,parsedData:parsed,structured,resumeId:null,_id:null,resume:null});
  }catch(err){next(err);}
};

exports.listResumes=async(req,res,next)=>{
  try{
    const resumes=await Resume.find({userId:req.user._id})
      .select("fileName fileType parsedData.name extractedKeywords createdAt").sort({createdAt:-1});
    res.json({success:true,resumes});
  }catch(err){next(err);}
};

exports.getResume=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    res.json({success:true,resume:r});
  }catch(err){next(err);}
};

exports.updateResume=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    if(req.body.parsedData)r.parsedData=deepMerge(r.parsedData.toObject(),req.body.parsedData);
    if(req.body.sectionOrder)r.sectionOrder=req.body.sectionOrder;
    if(req.body.hiddenSections)r.hiddenSections=req.body.hiddenSections;
    if(req.body.template)r.template=req.body.template;
    await r.save();res.json({success:true,resume:r});
  }catch(err){next(err);}
};

exports.deleteResume=async(req,res,next)=>{
  try{
    await Resume.findOneAndDelete({_id:req.params.id,userId:req.user._id});
    res.json({success:true,message:"Resume deleted."});
  }catch(err){next(err);}
};

exports.saveVersion=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    r.versions.push({savedAt:new Date(),label:req.body.label||`Version ${r.versions.length+1}`,snapshot:r.parsedData});
    if(r.versions.length>10)r.versions=r.versions.slice(-10);
    await r.save();res.json({success:true,versions:r.versions});
  }catch(err){next(err);}
};

exports.uploadJobDescription=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const text=await parseFile(req.file);
    let keywords=[];
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:"",job_description:text},{timeout:15000});
      keywords=r.data.jd_skills||[];
    }catch(e){}
    console.log("\n[JD Upload] JD Skills:");console.log(keywords);
    res.json({success:true,rawText:text,keywords,wordCount:text.split(/\s+/).length});
  }catch(err){next(err);}
};

// Exposed for the parser regression tests (tests/resumeParser.test.js).
exports.parseResumeText=parseResumeText;
