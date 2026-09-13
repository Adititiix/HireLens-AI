const path     = require("path");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");
const axios    = require("axios");
const Resume   = require("../models/Resume");
const {getFileType}=require("../middleware/upload");
const NLP = process.env.NLP_SERVICE_URL||"http://localhost:8000";

async function parseFile(file){
  const ext=path.extname(file.originalname).toLowerCase();
  if(ext===".pdf"||file.mimetype==="application/pdf"){
    const d=await pdfParse(file.buffer);
    if(!d.text||d.text.trim().length<20)throw new Error("PDF appears image-based. Use a text-based PDF.");
    return d.text;
  }
  if(ext===".docx"||file.mimetype==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
    // TASK 1 FIX: switched from mammoth.extractRawText (plain text, loses all
    // bullet/list structure) to mammoth.convertToHtml + a lightweight block-level
    // parser below. This preserves <li> list-item boundaries as bullets, which
    // extractRawText silently collapsed into ordinary paragraph text before —
    // that collapse was a real source of "bullets mixed into wrong section".
    const r=await mammoth.convertToHtml({buffer:file.buffer});
    return htmlToStructuredText(r.value);
  }
  return file.buffer.toString("utf-8");
}

// Minimal, dependency-free HTML→line-based-text transform. Converts each
// block-level element into its own line, and <li> into a "• " prefixed line,
// so downstream parseResumeText() sees the same bullet/paragraph boundaries
// a human would see in the DOCX, instead of one run-on paragraph.
function htmlToStructuredText(html){
  let out = html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|h[1-6]|div|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")            // strip remaining tags
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return out.split("\n").map(l=>l.trim()).filter(Boolean).join("\n");
}

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
  experience:     /^(experience|work experience|professional experience|employment history|career history)$/i,
  projects:       /^(projects|personal projects|academic projects|key projects|selected projects)$/i,
  skills:         /^(skills|technical skills|technologies|technical expertise|core skills|skills\s*&\s*technologies|technology stack|tech stack|technical proficiencies)$/i,
  education:      /^(education|academic background)$/i,
  certifications: /^(certifications?|certificates?|licenses?|credentials)$/i,
  achievements:   /^(achievements?|awards?|honors?)$/i,
};

const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
// Matches a trailing date or date-range at the end of a line, e.g. "Aug 2026",
// "Jun 2025 – Dec 2025", "2019 - 2023", "Present".
const TRAILING_DATE_RE = new RegExp(
  `((?:(?:${MONTH})\\.?\\s+)?\\d{4}\\s*(?:[-–—]\\s*(?:(?:(?:${MONTH})\\.?\\s+)?\\d{4}|present))?)\\s*$`, "i"
);

const CONTACT_LINE_RE = /@|linkedin\.com|github\.com|leetcode\.com|hackerrank\.com|https?:\/\/|www\.|^\+?\d[\d\s().-]{7,}\d$/i;

function getHeading(line){
  const clean = line.replace(/[:\-–_]+$/,"").trim();
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
const DEGREE_RE = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?tech|ph\.?\s?d\.?|bachelor|master|associate|mba)\b/i;

// Skills-section "Label : item1, item2, item3" line → schema-appropriate bucket.
// Maps into the EXISTING Resume schema buckets (technical/tools/cloud/soft/
// languages/programmingLanguages/frameworks/libraries/databases/developerTools) —
// no new schema fields invented, per "keep the current schema" instruction.
const SKILL_LABEL_MAP = [
  { re: /^languages?$/i,                         bucket: "programmingLanguages" },
  { re: /^(frameworks?|libraries)(\/|\s|$)/i,     bucket: "frameworks" },
  { re: /^databases?$/i,                          bucket: "databases" },
  { re: /^(developer tools|tools)$/i,             bucket: "developerTools" },
  { re: /^cloud$/i,                                bucket: "cloud" },
  { re: /^soft skills?$/i,                        bucket: "soft" },
];

function parseSkillsLine(line, skills){
  const m = line.match(/^([A-Za-z /&]{2,30}?)\s*:\s*(.+)$/);
  if(!m) return false;
  const [, label, itemsStr] = m;
  const items = itemsStr.split(",").map(s=>s.trim()).filter(Boolean);
  if(!items.length) return false;
  const match = SKILL_LABEL_MAP.find(e=>e.re.test(label.trim()));
  const bucket = match ? match.bucket : "technical"; // AI/ML, Core CS, Security, etc. → general bucket (no dedicated field exists)
  skills[bucket] = [...new Set([...(skills[bucket]||[]), ...items])];
  skills.technical = [...new Set([...(skills.technical||[]), ...items])]; // always keep the flat legacy list in sync
  return true;
}

function parseResumeText(text){
  const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);

  const emailMatch    = text.match(/[\w.\-]+@[\w.\-]+\.\w+/);
  const phoneMatch     = text.match(/[\+]?[\d][\d\s\-\(\)]{7,}/);
  const linkedinMatch  = text.match(/linkedin\.com\/[\w\-\/]+/i);
  const githubMatch    = text.match(/github\.com\/[\w\-]+/i);
  const leetcodeMatch  = text.match(/leetcode\.com\/[\w\-\/]+/i);
  const nameLine = lines.find(l =>
    l.length>2 && l.length<60 && !CONTACT_LINE_RE.test(l) && getHeading(l)===null
  );

  const skills = { programmingLanguages:[], frameworks:[], libraries:[], databases:[], cloud:[], developerTools:[], soft:[], technical:[], tools:[], languages:[] };
  const exp = [], edu = [], projs = [], certs = [];
  let curExp=null, curEdu=null, curProj=null;

  let section = null;

  for(const rawLine of lines){
    if(CONTACT_LINE_RE.test(rawLine) && section!==null && getHeading(rawLine)===null){
      // Contact/header noise appearing mid-document (e.g. a repeated footer) — skip, never
      // let it get assigned into whatever section happens to be open.
      continue;
    }

    const heading = getHeading(rawLine);
    if(heading){
      if(curExp) exp.push(curExp);  curExp=null;
      if(curEdu) edu.push(curEdu);  curEdu=null;
      if(curProj) projs.push(curProj); curProj=null;
      section = heading;
      continue;
    }

    if(section==="experience"){
      if(looksLikeEntryHeader(rawLine)){
        if(curExp) exp.push(curExp);
        const { name, rest, date } = splitNameAndMeta(rawLine);
        const { startDate, endDate } = parseDateRange(date);
        curExp = { id:uid(), title:name, company:rest, location:"", startDate, endDate, current:/present/i.test(endDate), description:"", bullets:[] };
      } else if(isBulletLine(rawLine) && curExp){
        curExp.bullets.push(stripBullet(rawLine));
      } else if(curExp && !curExp.company && rawLine.length<80){
        // First non-bullet line right after a bare title (no "|") — treat as company/location.
        curExp.company = rawLine;
      }
    } else if(section==="projects"){
      if(looksLikeEntryHeader(rawLine)){
        if(curProj) projs.push(curProj);
        const { name, rest, date } = splitNameAndMeta(rawLine);
        const technologies = rest.split(",").map(s=>s.trim()).filter(Boolean);
        curProj = { id:uid(), name, description:"", technologies, githubUrl:"", liveDemoUrl:"", additionalUrl:"" };
      } else if(isBulletLine(rawLine) && curProj){
        const clean = stripBullet(rawLine);
        if(/github\.com/i.test(clean)) curProj.githubUrl = clean;
        else if(/live demo|https?:\/\//i.test(clean) && !curProj.liveDemoUrl) curProj.liveDemoUrl = clean.match(/https?:\/\/\S+/)?.[0] || clean;
        else curProj.description += (curProj.description ? " " : "") + clean;
      } else if(curProj && /github\.com/i.test(rawLine)){
        curProj.githubUrl = rawLine.trim();
      }
    } else if(section==="education"){
      if(DEGREE_RE.test(rawLine) || TRAILING_DATE_RE.test(rawLine)){
        if(curEdu && curEdu.degree) edu.push(curEdu), curEdu=null;
        if(!curEdu) curEdu = { id:uid(), degree:"", institution:"", location:"", startDate:"", endDate:"", gpa:"", honors:"" };
        const gpaMatch = rawLine.match(/(?:cgpa|gpa)\s*:?\s*(\d+\.?\d*)/i);
        if(gpaMatch) curEdu.gpa = gpaMatch[1];
        const dateMatch = rawLine.match(TRAILING_DATE_RE);
        if(dateMatch && /\d{4}/.test(dateMatch[1])){
          const { startDate, endDate } = parseDateRange(dateMatch[1].trim());
          curEdu.startDate = startDate; curEdu.endDate = endDate;
        }
        if(DEGREE_RE.test(rawLine) && !curEdu.degree){
          curEdu.degree = rawLine.replace(TRAILING_DATE_RE,"").replace(/\s*(?:cgpa|gpa)\s*:?\s*\d+\.?\d*(?:\/\d+)?\s*$/i,"").trim();
        } else if(!curEdu.institution && !gpaMatch){
          curEdu.institution = rawLine.replace(TRAILING_DATE_RE,"").trim();
        }
      } else if(curEdu && !curEdu.institution){
        curEdu.institution = rawLine;
      }
    } else if(section==="certifications"){
      if(rawLine.length>3){
        const yr = rawLine.match(/\d{4}/);
        certs.push({ id:uid(), name: rawLine.replace(/\d{4}/,"").trim(), provider:"", issueDate: yr?yr[0]:"", credentialId:"", credentialUrl:"" });
      }
    } else if(section==="skills"){
      if(!parseSkillsLine(rawLine, skills)){
        // No "Label:" pattern — treat as a bare comma-separated skills line.
        const items = rawLine.split(",").map(s=>s.trim()).filter(Boolean);
        if(items.length){ skills.technical = [...new Set([...skills.technical, ...items])]; }
      }
    }
  }
  if(curExp) exp.push(curExp);
  if(curEdu && curEdu.degree) edu.push(curEdu);
  if(curProj) projs.push(curProj);

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
    const summaryLines=[];
    for(let i=summaryStart+1;i<lines.length;i++){
      if(getHeading(lines[i])) break;
      summaryLines.push(lines[i]);
    }
    summary = summaryLines.join(" ");
  }

  return {
    name:nameLine||"", email:emailMatch?emailMatch[0]:"", phone:phoneMatch?phoneMatch[0]:"",
    location:"", linkedin:linkedinMatch?linkedinMatch[0]:"", github:githubMatch?githubMatch[0]:"",
    portfolio:"", leetcode:leetcodeMatch?leetcodeMatch[0]:"", hackerrank:"", otherLinks:[],
    summary,
    skills,
    experience:exp, education:edu, projects:projs, certifications:certs, achievements:[], additionalInfo:"",
  };
}

exports.uploadResume=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const text=await parseFile(req.file);
    let structured={resume_skills:[],jd_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){console.warn("[resumeController] NLP /extract failed:",e.message);}
    const parsed=parseResumeText(text);
    const nlpSkills=structured.resume_skills||[];
    parsed.skills.technical=[...new Set([...parsed.skills.technical,...nlpSkills])];
    parsed.skills.programmingLanguages=[...new Set([...parsed.skills.programmingLanguages,...nlpSkills])];
    console.log("\n[ResumeUpload] Extracted Skills:");console.log(parsed.skills.technical);
    console.log(`[ResumeUpload] Structured: ${parsed.experience.length} experience, ${parsed.projects.length} projects, ${parsed.education.length} education entries`);
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
    const text=await parseFile(req.file);
    let structured={resume_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){}
    const parsed=parseResumeText(text);
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
