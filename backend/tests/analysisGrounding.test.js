// Regression: stored / stale /analyze suggestions must not serve "… with 3+ years of experience …"
// for a resume that never states a duration. Models are stubbed — no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const Analysis = require("../models/Analysis");
const Resume = require("../models/Resume");
const c = require("../controllers/analysisController");
const { unsupportedDurationClaims, groundImprovements } = require("../utils/suggestionGrounding");

const RESUME_TEXT = "ADITI S\nSoftware Engineering Intern | Briddlee | Jun 2025 - Aug 2025\nPROJECTS\nHireLens AI\nSKILLS\nPython, SQL";
const FABRICATED = { section: "Professional Summary", type: "summary_rewrite", original: "",
  suggestion: "Results-driven Technology Development Program \nSoftware Engineer with 3+ years of experience building scalable, high-performance applications." };
const GROUNDED = { section: "Professional Summary", type: "summary_rewrite", original: "",
  suggestion: "Experience includes projects and internship work. Skills include Python and SQL." };
const SKILLS_TIP = { section: "Skills", type: "add_skills", original: "", suggestion: "The job asks for skills your resume doesn't mention: Java.", skills: ["java"] };

function fakeRes() {
  return { statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
}
const doc = obj => ({ ...obj, toObject() { return JSON.parse(JSON.stringify(obj)); } });

test("duration claims are unsupported unless the resume states them", () => {
  assert.deepEqual(unsupportedDurationClaims(FABRICATED.suggestion, RESUME_TEXT), ["3+ years"]);
  assert.deepEqual(unsupportedDurationClaims("2 years of experience", "Analyst, 2  years of experience"), []);
  assert.deepEqual(unsupportedDurationClaims("Built 3 dashboards in 2025", RESUME_TEXT), []);
  assert.deepEqual(groundImprovements([FABRICATED, GROUNDED, SKILLS_TIP], RESUME_TEXT), [GROUNDED, SKILLS_TIP]);
});

test("a new analysis from a stale NLP service never stores the fabricated summary", () => {
  const nlp = { suggestions: [{ ...FABRICATED, suggested: FABRICATED.suggestion }, { ...SKILLS_TIP, suggested: SKILLS_TIP.suggestion }] };
  const mapped = c.mapNLP(nlp, "Technology Development Program Software Engineer, 3+ years required", RESUME_TEXT);
  assert.deepEqual(mapped.improvements.map(i => i.type), ["add_skills"]);
  assert.deepEqual(mapped.improvements[0].skills, ["java"], "per-skill list kept for the confirmation UI");
});

test("viewing a stored analysis (History) filters the fabricated summary and does not return rawText", async (t) => {
  const stored = doc({ _id: "a1", improvements: [FABRICATED, SKILLS_TIP],
    resume: { _id: "r1", fileName: "cv.pdf", parsedData: { summary: "" }, rawText: RESUME_TEXT } });
  t.mock.method(Analysis, "findOne", () => ({ populate: async () => stored }));
  const res = fakeRes();
  await c.getAnalysisById({ params: { id: "a1" }, user: { _id: "u1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.analysis.improvements.map(i => i.type), ["add_skills"]);
  assert.equal(res.body.analysis.resume.rawText, undefined);
  assert.equal(stored.improvements.length, 2, "the stored document itself is not modified");
});

test("latest analysis for a resume is filtered the same way", async (t) => {
  const stored = doc({ _id: "a2", resume: "r1", improvements: [FABRICATED, GROUNDED] });
  t.mock.method(Analysis, "findOne", () => ({ sort: async () => stored }));
  t.mock.method(Resume, "findById", () => ({ lean: async () => ({ rawText: RESUME_TEXT }) }));
  const res = fakeRes();
  await c.getAnalysis({ params: { resumeId: "r1" }, user: { _id: "u1" } }, res);
  assert.deepEqual(res.body.analysis.improvements, [GROUNDED]);
});
