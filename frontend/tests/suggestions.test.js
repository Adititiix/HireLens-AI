// Tests for applying AI suggestions to editor state and the panel's state machine. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { applySuggestion, buildSuggestionRequest, initialSuggestionsState, suggestionsReducer } from "../src/utils/suggestions.js";

const resume = () => ({
  name: "Jane", linkedin: "https://linkedin.com/in/jane", github: "https://github.com/jane",
  summary: "Student building ML apps.",
  experience: [{ id: "e1", title: "Intern", company: "Acme", startDate: "Jun 2025", bullets: [
    "Responsible for maintaining the booking API.", "Built the admin dashboard.", "Contributed to the billing API."] }],
  projects: [{ id: "p1", name: "HireLens", githubUrl: "https://github.com/jane/hirelens", description: "Used React, FastAPI and NLP.\nBuilt semantic matching." }],
  skills: { technical: ["Python"] },
});
const sug = (over = {}) => ({
  id: "s1", applicable: true, original_text: "Responsible for maintaining the booking API.", suggested_text: "Maintained the booking API.",
  target: { section: "experience", entry_index: 0, entry_id: "e1", field: "bullets", line_index: 0 }, ...over,
});

test("accept replaces only the targeted bullet and preserves everything else (links, dates, other entries)", () => {
  const before = resume();
  const r = applySuggestion(before, sug(), "Maintained the booking API.");
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.experience[0].bullets, ["Maintained the booking API.", "Built the admin dashboard.", "Contributed to the billing API."]);
  assert.equal(r.data.linkedin, before.linkedin);
  assert.equal(r.data.projects, before.projects, "untouched sections keep their identity");
  assert.equal(r.data.experience[0].startDate, "Jun 2025");
  assert.deepEqual(before.experience[0].bullets[0], "Responsible for maintaining the booking API.", "input not mutated");
});

test("project description line is replaced inside the newline-separated description", () => {
  const s = sug({ original_text: "Used React, FastAPI and NLP.", target: { section: "projects", entry_index: 0, entry_id: "p1", field: "description", line_index: 0 } });
  const r = applySuggestion(resume(), s, "Used React, FastAPI and NLP for the AI resume screening platform.");
  assert.equal(r.ok, true);
  assert.equal(r.data.projects[0].description, "Used React, FastAPI and NLP for the AI resume screening platform.\nBuilt semantic matching.");
  assert.equal(r.data.projects[0].githubUrl, "https://github.com/jane/hirelens");
});

test("edited text is applied instead of the suggestion", () => {
  const r = applySuggestion(resume(), sug(), "Maintained and documented the booking API.");
  assert.equal(r.data.experience[0].bullets[0], "Maintained and documented the booking API.");
});

test("a split suggestion becomes separate bullets in place", () => {
  const r = applySuggestion(resume(), sug(), "Maintained the booking API.\nDocumented its endpoints.");
  assert.deepEqual(r.data.experience[0].bullets.slice(0, 2), ["Maintained the booking API.", "Documented its endpoints."]);
  assert.equal(r.data.experience[0].bullets.length, 4);
});

test("refuses when the line changed since the suggestion was made (no silent overwrite)", () => {
  const data = resume();
  data.experience[0].bullets[0] = "Maintained the booking API and its docs.";
  const r = applySuggestion(data, sug(), "Maintained the booking API.");
  assert.equal(r.ok, false);
  assert.match(r.reason, /changed/);
});

test("refuses entries that no longer exist and suggestions without a target", () => {
  const data = resume(); data.experience = [];
  assert.equal(applySuggestion(data, sug(), "x").ok, false);
  assert.equal(applySuggestion(resume(), sug({ target: null }), "x").ok, false);
});

test("finds the entry by id even after entries were reordered", () => {
  const data = resume();
  data.experience.unshift({ id: "e0", title: "Other", bullets: ["Something else."] });
  const r = applySuggestion(data, sug(), "Maintained the booking API.");
  assert.equal(r.ok, true);
  assert.equal(r.data.experience[1].bullets[0], "Maintained the booking API.");
  assert.deepEqual(r.data.experience[0].bullets, ["Something else."]);
});

test("never introduces a duplicate bullet", () => {
  const r = applySuggestion(resume(), sug(), "Contributed to the billing API.");
  assert.equal(r.ok, false);
  assert.match(r.reason, /already contains/);
});

test("empty text is rejected", () => {
  assert.equal(applySuggestion(resume(), sug(), "   ").ok, false);
});

test("request builder sends editor data + optional job description and skill gap", () => {
  const body = buildSuggestionRequest(resume(), { jobDescription: "  Python role  ", analysis: { skillGap: { missing: ["docker"], matched: ["python"], highMissing: ["docker"] } } });
  assert.equal(body.jobDescription, "Python role");
  assert.deepEqual(body.analysis, { missing_skills: ["docker"], matched_skills: ["python"], high_missing: ["docker"], medium_missing: [] });
  assert.equal(body.resume.experience[0].bullets.length, 3);
  assert.equal("linkedin" in body.resume, false, "contact details/links are not sent for suggestions");
  assert.equal(buildSuggestionRequest(resume()).analysis, undefined);
});

// ── panel state ──
const S = [{ id: "a", suggested_text: "X" }, { id: "b", suggested_text: "" }];

test("loading → success / empty / error states", () => {
  let st = suggestionsReducer(initialSuggestionsState, { type: "request" });
  assert.equal(st.status, "loading");
  assert.equal(suggestionsReducer(st, { type: "success", suggestions: S }).status, "success");
  assert.equal(suggestionsReducer(st, { type: "success", suggestions: [] }).status, "empty");
  const err = suggestionsReducer(st, { type: "failure", error: "NLP down" });
  assert.equal(err.status, "error");
  assert.equal(err.error, "NLP down");
});

test("accept, edit, reject, dismiss and restore actions", () => {
  let st = suggestionsReducer(initialSuggestionsState, { type: "success", suggestions: S });
  st = suggestionsReducer(st, { type: "edit", id: "a" });
  assert.equal(st.items[0].editing, true);
  st = suggestionsReducer(st, { type: "draft", id: "a", text: "Y" });
  assert.equal(st.items[0].draft, "Y");
  st = suggestionsReducer(st, { type: "accepted", id: "a" });
  assert.equal(st.items[0].status, "accepted");
  assert.equal(st.items[0].editing, false);
  st = suggestionsReducer(st, { type: "reject", id: "b" });
  assert.equal(st.items[1].status, "rejected");
  st = suggestionsReducer(st, { type: "restore", id: "b" });
  assert.equal(st.items[1].status, "pending");
  st = suggestionsReducer(st, { type: "dismiss", id: "b" });
  assert.equal(st.items[1].status, "dismissed");
  st = suggestionsReducer(st, { type: "applyFailed", id: "a", reason: "changed" });
  assert.equal(st.items[0].note, "changed");
});
