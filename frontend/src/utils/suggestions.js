/**
 * AI Resume Suggestions — pure helpers (no React), shared by SuggestionsPanel, EditorPage and their tests.
 *
 * applySuggestion() edits ONLY the one line a suggestion targets, and refuses when
 * that line no longer matches the text the suggestion was made for (the user
 * edited it meanwhile). Nothing is ever applied without an explicit user action.
 *
 * Lifecycle of a suggestion: pending → applying → accepted ("Applied": the editor's resume data was
 * changed and, when the resume is stored, the save succeeded) | failed (save failed: the change is rolled
 * back and the suggestion stays retryable) | rejected | dismissed.
 */
import { collectTechnicalSkills, hasSkill } from "./skillCategories.js";

const BULLET_PREFIX = /^\s*(?:[•\-–*▪●○■□◦►▸➢➤✓✔→]|\d+[.)])\s*/;
export const normalizeLine = s => String(s ?? "").replace(BULLET_PREFIX, "").replace(/\s+/g, " ").trim();
const same = (a, b) => normalizeLine(a).toLowerCase() === normalizeLine(b).toLowerCase();

/** Editor state (Resume.parsedData shape) → request body for POST /api/resume/suggestions. */
export function buildSuggestionRequest(data, { jobDescription = "", analysis = null } = {}) {
  const skillGap = analysis?.skillGap;
  return {
    resume: {
      summary: data?.summary || "",
      experience: (data?.experience || []).map(e => ({ id: e.id || "", title: e.title || "", company: e.company || "", bullets: (e.bullets || []).filter(Boolean) })),
      projects: (data?.projects || []).map(p => ({ id: p.id || "", name: p.name || "", description: p.description || "", technologies: (p.technologies || []).filter(Boolean) })),
      achievements: (data?.achievements || []).map(a => ({ id: a.id || "", title: a.title || "", description: a.description || "" })),
      skills: data?.skills || {},
      education: (data?.education || []).map(e => ({ degree: e.degree || "", institution: e.institution || "" })),
      certifications: (data?.certifications || []).map(c => ({ name: c.name || "" })),
    },
    jobDescription: (jobDescription || "").trim(),
    ...(skillGap ? { analysis: { missing_skills: skillGap.missing || [], matched_skills: skillGap.matched || [],
                                  high_missing: skillGap.highMissing || [], medium_missing: skillGap.mediumMissing || [] } } : {}),
  };
}

function findEntry(list, target) {
  if (target.entry_id) {
    const i = list.findIndex(e => e?.id === target.entry_id);
    if (i !== -1) return i;
  }
  return Number.isInteger(target.entry_index) && list[target.entry_index] ? target.entry_index : -1;
}

/**
 * Apply `text` (the suggestion, or the user's edited version) at suggestion.target.
 * Returns { ok: true, data } with a new data object, or { ok: false, reason } and leaves data untouched.
 */
export function applySuggestion(data, suggestion, text) {
  const t = suggestion?.target;
  const newLines = String(text ?? "").split("\n").map(normalizeLine).filter(Boolean);
  if (!t) return { ok: false, reason: "This suggestion isn't tied to a single line — copy it instead." };
  if (!newLines.length) return { ok: false, reason: "The suggested text is empty." };

  if (t.section === "summary" && t.field === "summary") {
    if (!same(data.summary, suggestion.original_text)) return { ok: false, reason: "Your summary has changed since this suggestion was made." };
    return { ok: true, data: { ...data, summary: newLines.join(" ") } };
  }

  const key = t.section === "experience" ? "experience" : t.section === "projects" ? "projects" : null;
  if (!key) return { ok: false, reason: "Unsupported section." };
  const list = data[key] || [];
  const ei = findEntry(list, t);
  if (ei === -1) return { ok: false, reason: "That entry no longer exists in your resume." };
  const entry = list[ei];
  const lines = key === "experience" ? [...(entry.bullets || [])] : String(entry.description || "").split("\n");
  const li = t.line_index;
  if (!Number.isInteger(li) || li < 0 || li >= lines.length || !same(lines[li], suggestion.original_text)) {
    return { ok: false, reason: "That line has changed since the suggestion was made — re-run suggestions or copy the text." };
  }
  // Never create duplicate bullets: drop new lines that already exist elsewhere in this entry.
  const others = lines.filter((_, i) => i !== li).map(l => normalizeLine(l).toLowerCase());
  const unique = newLines.filter(l => !others.includes(l.toLowerCase()));
  if (!unique.length) return { ok: false, reason: "This entry already contains that text." };
  lines.splice(li, 1, ...unique);
  const updated = key === "experience" ? { ...entry, bullets: lines } : { ...entry, description: lines.join("\n") };
  const nextList = list.map((e, i) => (i === ei ? updated : e));
  return { ok: true, data: { ...data, [key]: nextList } };   // every other field (links, dates, …) is untouched
}

// ── Changes: what an applied suggestion changed, so a failed save can be rolled back ──────────
/** The top-level resume fields that differ (by identity — the helpers keep untouched fields as-is). */
export function describeChange(before, after) {
  const keys = Object.keys({ ...before, ...after }).filter(k => before?.[k] !== after?.[k]);
  return { keys, before: Object.fromEntries(keys.map(k => [k, before?.[k]])), after: Object.fromEntries(keys.map(k => [k, after?.[k]])) };
}

/**
 * Undo `change` on the current data — only where the field still holds exactly what the change wrote,
 * so an edit the user made meanwhile is never overwritten. Returns { data, conflicts: [field…] }.
 */
export function rollbackChange(current, change) {
  const data = { ...current };
  const conflicts = [];
  for (const k of change?.keys || []) {
    if (JSON.stringify(current?.[k]) === JSON.stringify(change.after[k])) data[k] = change.before[k];
    else conflicts.push(k);
  }
  return { data, conflicts };
}

/**
 * Commit an accepted change: canonical editor state first (the live preview re-renders from it), then the save.
 * A failed save rolls back exactly what the change wrote (unless edited meanwhile) and throws, so the caller
 * shows "failed" (retryable) instead of a false "Applied". Not stored → applied in the editor only, with a note.
 */
export async function commitResumeChange({ next, change, setData, getData, persist, notStoredReason = "" }) {
  setData(next);
  if (notStoredReason) return { saved: false, note: `In the editor only — ${notStoredReason}.` };
  try {
    await persist(next);
    return { saved: true, note: "" };
  } catch (err) {
    const { data, conflicts } = rollbackChange(getData(), change);
    setData(data);
    throw new Error(`Couldn't save, so the change was undone${conflicts.length ? " (except fields you edited meanwhile)" : ""}. ${err?.userMessage || err?.message || ""}`.trim());
  }
}

// ── Skills ────────────────────────────────────────────────────────────────────
/**
 * Add skills the user CONFIRMED they have to the Skills section (`skills.technical`, where the editor and
 * preview read them; grouping happens at display time). Alias-aware duplicates are skipped.
 */
export function addSkills(data, skills = []) {
  const existing = collectTechnicalSkills(data?.skills);
  const added = [], skipped = [];
  for (const raw of skills) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    (hasSkill([...existing, ...added], s) ? skipped : added).push(s);
  }
  if (!added.length) return { ok: false, reason: skipped.length ? `Already in your Skills: ${skipped.join(", ")}.` : "No skill selected.", added, skipped };
  const sk = data?.skills || {};
  return { ok: true, data: { ...data, skills: { ...sk, technical: [...(sk.technical || []), ...added] } }, added, skipped };
}

// ── Experience-duration grounding (same rule as backend/utils/suggestionGrounding.js) ──────────
const DURATION = /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|several|many|multiple)\s*\+?\s*(?:years?|yrs?)\b/gi;
const squash = s => String(s || "").toLowerCase().replace(/\s+/g, " ");

/** Every text field of the editor's resume data, for checking what the resume itself states. */
export function resumeText(data) {
  const out = [];
  const walk = v => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(data);
  return out.join("\n");
}

/** "3+ years"-style phrases in `text` that the resume does not literally contain. */
export function unsupportedDurationClaims(text, data) {
  const resume = squash(resumeText(data));
  return (String(text || "").match(DURATION) || []).filter(m => !resume.includes(squash(m)));
}

// ── Legacy /analyze improvements (shown inside each editor section) ─────────────────────────
/** Skills an add_skills tip names ("skills" list; older analyses only have them in the text). */
export function improvementSkills(imp) {
  if (Array.isArray(imp?.skills) && imp.skills.length) return imp.skills;
  const m = String(imp?.suggestion || "").match(/:\s*([^.]+?)(?:\.\s|\.?$)/);
  return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
}

/**
 * Analysis improvements → independent tips, each with its own stable `id` (and so its own lifecycle).
 * An add_skills improvement names several job skills; each becomes its own tip, so confirming and adding
 * one skill can never mark the others as applied.
 */
export function splitImprovements(improvements = []) {
  const out = [];
  improvements.forEach((imp, i) => {
    if (imp?.type === "add_skills") {
      for (const sk of improvementSkills(imp)) {
        out.push({ ...imp, id: `add_skills:${sk.toLowerCase()}`, skills: [sk],
                   suggestion: `The job asks for ${sk}, which your resume doesn't mention. Add it only if you have actually used it.` });
      }
    } else {
      out.push({ ...imp, id: `${imp?.type}:${i}:${imp?.original || ""}:${imp?.suggestion || ""}` });
    }
  });
  return out.filter((t, i) => out.findIndex(x => x.id === t.id) === i);
}

/** How an improvement can be applied: "summary" | "skills" | "bullet" | null (informational only). */
export function improvementKind(imp) {
  if (imp?.type === "summary_rewrite") return "summary";
  if (imp?.type === "add_skills") return "skills";
  if (imp?.type === "bullet_rewrite" && imp.original && imp.suggestion) return "bullet";
  return null;
}

function findLine(data, original) {
  const hits = [];
  (data.experience || []).forEach((e, i) => (e.bullets || []).forEach((b, j) => {
    if (same(b, original)) hits.push({ section: "experience", entry_index: i, entry_id: e.id || "", field: "bullets", line_index: j });
  }));
  (data.projects || []).forEach((p, i) => String(p.description || "").split("\n").forEach((l, j) => {
    if (same(l, original)) hits.push({ section: "projects", entry_index: i, entry_id: p.id || "", field: "description", line_index: j });
  }));
  return hits;
}

/**
 * Apply a legacy improvement to the editor's resume data.
 *   summary  — replaces the summary; refused if it states an experience duration the resume doesn't.
 *   skills   — adds only `opts.skills`, the skills the user confirmed (never the whole job-description list).
 *   bullet   — replaces the one editor line that still reads exactly like `original`.
 * Returns { ok: true, data } or { ok: false, reason } (data untouched).
 */
export function applyImprovement(data, imp, opts = {}) {
  const kind = improvementKind(imp);
  if (kind === "summary") {
    const text = normalizeLine(imp.suggestion);
    if (!text) return { ok: false, reason: "The suggested summary is empty." };
    const claims = unsupportedDurationClaims(text, data);
    if (claims.length) return { ok: false, reason: `Not applied: it claims "${claims[0]}" of experience, which your resume doesn't state.` };
    if (same(data.summary, text)) return { ok: false, reason: "Your summary already says this." };
    return { ok: true, data: { ...data, summary: text } };
  }
  if (kind === "skills") {
    const allowed = improvementSkills(imp);
    const chosen = (opts.skills || []).filter(s => allowed.some(a => a.toLowerCase() === String(s).toLowerCase()));
    if (!chosen.length) return { ok: false, reason: "Select the skills you have actually used." };
    return addSkills(data, chosen);
  }
  if (kind === "bullet") {
    const hits = findLine(data, imp.original);
    if (hits.length !== 1) return { ok: false, reason: hits.length ? "That text appears in more than one entry — edit it directly." : "That line is no longer in your resume — it may have been edited." };
    return applySuggestion(data, { target: hits[0], original_text: imp.original }, imp.suggestion);
  }
  return { ok: false, reason: "This tip can't be applied automatically." };
}

// ── Panel state ─────────────────────────────────────────────────────────────
export const initialSuggestionsState = { status: "idle", items: [], error: "", meta: null };

export function suggestionsReducer(state, action) {
  switch (action.type) {
    case "request": return { ...state, status: "loading", error: "" };
    case "success": {
      const items = (action.suggestions || []).map(s => ({ ...s, status: "pending", editing: false, draft: s.suggested_text || "", note: "" }));
      return { status: items.length ? "success" : "empty", items, error: "", meta: { summary: action.summary, engine: action.engine } };
    }
    case "failure": return { ...state, status: "error", error: action.error || "Could not generate suggestions." };
    case "edit": return mapItem(state, action.id, s => ({ ...s, editing: true, draft: s.draft || s.suggested_text || s.original_text, note: "" }));
    case "draft": return mapItem(state, action.id, s => ({ ...s, draft: action.text }));
    case "cancelEdit": return mapItem(state, action.id, s => ({ ...s, editing: false, draft: s.suggested_text || "" }));
    case "confirm": return mapItem(state, action.id, s => ({ ...s, confirmed: !!action.value, note: "" }));
    case "applying": return mapItem(state, action.id, s => ({ ...s, status: "applying", note: "" }));
    case "accepted": return mapItem(state, action.id, s => ({ ...s, status: "accepted", editing: false, note: action.note || "" }));
    case "commitFailed": return mapItem(state, action.id, s => ({ ...s, status: "failed", note: action.reason || "Could not save the change." }));
    case "applyFailed": return mapItem(state, action.id, s => ({ ...s, note: action.reason }));
    case "reject": return mapItem(state, action.id, s => ({ ...s, status: "rejected", editing: false }));
    case "dismiss": return mapItem(state, action.id, s => ({ ...s, status: "dismissed", editing: false }));
    case "restore": return mapItem(state, action.id, s => ({ ...s, status: "pending", note: "" }));
    default: return state;
  }
}
/** Open (still actionable) vs closed suggestions. */
export const isOpen = s => s.status === "pending" || s.status === "applying" || s.status === "failed";

function mapItem(state, id, fn) {
  return { ...state, items: state.items.map(s => (s.id === id ? fn(s) : s)) };
}
