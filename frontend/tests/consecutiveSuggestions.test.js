// Regression: after accepting one suggestion, the next one lost its Accept/Apply action.
// Root cause: the Skills analysis tip bundled every job skill into ONE tip with ONE status — adding the first
// skill marked the whole tip "Applied" and removed the action for the rest. Each tip (one per skill) now has
// its own id and lifecycle in the tips reducer.
// These tests drive the REAL AnalysisTip / SuggestionCard components and the real accept handler, with an
// in-memory editor + server wired like EditorPage (setData / persist / rollback). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { addSkills, applySuggestion, commitResumeChange, describeChange, initialSuggestionsState, isOpen,
         splitImprovements, suggestionsReducer } from "../src/utils/suggestions.js";
import { loadComponentRenderer, loadJsxModule, loadPreviewRenderer } from "./renderPreview.js";

const renderTip = await loadComponentRenderer("src/components/editor/AnalysisTip.jsx");
const renderCard = await loadComponentRenderer("src/components/editor/SuggestionsPanel.jsx", "SuggestionCard");
const renderPreview = await loadPreviewRenderer();
const { acceptTip } = loadJsxModule("src/components/editor/AnalysisTip.jsx");
const ORDER = ["header", "summary", "skills", "experience", "projects", "education"];

const resume = () => ({
  name: "Aditi S", summary: "", skills: { technical: ["Python", "React"], soft: [] },
  experience: [{ id: "e1", title: "Software Engineering Intern", company: "Briddlee",
                 bullets: ["Worked on REST APIs with Flask", "Made a dashboard for the support team"] }],
  projects: [], education: [],
});
// The analysis tips stored for the user's latest resume had this shape (6 skills, no `skills` field).
const ANALYSIS = [
  { section: "Skills", type: "add_skills", original: "", suggestion: "Add these in-demand skills to your profile: GCP, Docker, Agile" },
  { section: "Work Experience", type: "bullet_rewrite", original: "Worked on REST APIs with Flask", suggestion: "Built REST APIs with Flask" },
  { section: "Work Experience", type: "bullet_rewrite", original: "Made a dashboard for the support team", suggestion: "Developed a dashboard for the support team" },
];

/** Editor + tips store + server, wired like EditorPage. */
function editor({ failNextSave = false } = {}) {
  const h = { data: resume(), saved: null, saves: 0, failNextSave };
  h.tips = suggestionsReducer(initialSuggestionsState, { type: "success", suggestions: splitImprovements(ANALYSIS) });
  h.dispatch = a => { h.tips = suggestionsReducer(h.tips, a); };
  h.onCommit = (next, change) => commitResumeChange({ next, change, setData: d => { h.data = d; }, getData: () => h.data,
    persist: async n => { h.saves++; if (h.failNextSave) { h.failNextSave = false; throw new Error("Network Error"); } h.saved = structuredClone(n); } });
  h.tip = id => h.tips.items.find(t => t.id === id);
  h.html = id => renderTip({ tip: h.tip(id), data: h.data, dispatch: h.dispatch, onCommit: h.onCommit });
  h.accept = id => acceptTip(h.tip(id), h.data, h.dispatch, h.onCommit);
  return h;
}
const applyTag = html => /<button data-action="apply"[^>]*>/.exec(html)?.[0];
const hasApply = html => !!applyTag(html);                                   // the action is rendered
const applyEnabled = html => hasApply(html) && !/\sdisabled=""/.test(applyTag(html));   // …and clickable
const SK = { gcp: "add_skills:gcp", docker: "add_skills:docker", agile: "add_skills:agile" };
const BULLETS = () => splitImprovements(ANALYSIS).filter(t => t.type === "bullet_rewrite").map(t => t.id);

test("the multi-skill tip becomes one independent tip per skill, each with its own action", () => {
  const h = editor();
  assert.deepEqual(h.tips.items.filter(t => t.type === "add_skills").map(t => t.id), Object.values(SK));
  for (const id of [...Object.values(SK), ...BULLETS()]) {
    assert.equal(h.tip(id).status, "pending");
    assert.ok(hasApply(h.html(id)), `${id} shows Apply`);
  }
  assert.equal(applyEnabled(h.html(SK.gcp)), false, "skill tips stay disabled until the user confirms");
  assert.equal(applyEnabled(h.html(BULLETS()[0])), true);
});

test("applying the first skill leaves the next skill actionable, and both can be applied in turn", async () => {
  const h = editor();
  h.dispatch({ type: "confirm", id: SK.gcp, value: true });
  await h.accept(SK.gcp);
  assert.equal(h.tip(SK.gcp).status, "accepted");
  assert.match(h.html(SK.gcp), /Applied to Skills/);
  assert.equal(h.tip(SK.docker).status, "pending", "the other skill is not marked applied");
  assert.ok(hasApply(h.html(SK.docker)), "the next skill still has its action (the reported bug)");
  assert.match(renderPreview({ data: h.data, sectionOrder: ORDER }), /GCP/);

  h.dispatch({ type: "confirm", id: SK.docker, value: true });
  assert.equal(applyEnabled(h.html(SK.docker)), true);
  await h.accept(SK.docker);
  assert.equal(h.tip(SK.docker).status, "accepted");
  assert.deepEqual(h.data.skills.technical, ["Python", "React", "GCP", "Docker"]);
  assert.deepEqual(h.saved.skills.technical, ["Python", "React", "GCP", "Docker"], "both persisted");
  assert.equal(h.saves, 2);
  assert.ok(!h.data.skills.technical.includes("Agile"), "the unconfirmed skill is not claimed");
  const html = renderPreview({ data: h.data, sectionOrder: ORDER });
  assert.match(html, /GCP/); assert.match(html, /Docker/);
});

test("two bullet tips can be accepted consecutively and each updates its own line", async () => {
  const h = editor();
  const [a, b] = BULLETS();
  await h.accept(a);
  assert.equal(h.tip(a).status, "accepted");
  assert.ok(applyEnabled(h.html(b)), "second tip keeps an enabled Apply after the first is applied");
  await h.accept(b);
  assert.equal(h.tip(b).status, "accepted");
  assert.deepEqual(h.data.experience[0].bullets, ["Built REST APIs with Flask", "Developed a dashboard for the support team"]);
  assert.deepEqual(h.saved.experience[0].bullets, h.data.experience[0].bullets);
  assert.match(renderPreview({ data: h.data, sectionOrder: ORDER }), /Developed a dashboard for the support team/);
});

test("applying a skill tip does not remove the action from a different kind of tip", async () => {
  const h = editor();
  h.dispatch({ type: "confirm", id: SK.agile, value: true });
  await h.accept(SK.agile);
  for (const id of BULLETS()) assert.ok(applyEnabled(h.html(id)), id);
});

test("a failed save on the first tip does not disable the second; the first stays retryable", async () => {
  const h = editor({ failNextSave: true });
  const [a, b] = BULLETS();
  await h.accept(a);
  assert.equal(h.tip(a).status, "failed");
  assert.equal(h.data.experience[0].bullets[0], "Worked on REST APIs with Flask", "rolled back");
  assert.match(h.html(a), />Retry</);
  assert.ok(applyEnabled(h.html(b)));
  await h.accept(b);
  assert.equal(h.tip(b).status, "accepted");
  await h.accept(a);                                              // retry now succeeds
  assert.equal(h.tip(a).status, "accepted");
  assert.deepEqual(h.saved.experience[0].bullets, ["Built REST APIs with Flask", "Developed a dashboard for the support team"]);
});

test("rejecting one tip leaves unrelated tips pending and the resume untouched", () => {
  const h = editor();
  const before = structuredClone(h.data);
  h.dispatch({ type: "reject", id: SK.gcp });
  assert.equal(h.tip(SK.gcp).status, "rejected");
  assert.match(h.html(SK.gcp), /rejected — your resume was not changed/);
  assert.ok(hasApply(h.html(SK.docker)));
  assert.ok(applyEnabled(h.html(BULLETS()[0])));
  assert.deepEqual(h.data, before);
});

test("an applied tip cannot be applied twice (no second save, no duplicate skill)", async () => {
  const h = editor();
  h.dispatch({ type: "confirm", id: SK.gcp, value: true });
  await h.accept(SK.gcp);
  await h.accept(SK.gcp);
  assert.equal(h.saves, 1);
  assert.equal(h.data.skills.technical.filter(s => s === "GCP").length, 1);
  assert.doesNotMatch(h.html(SK.gcp), /data-action="apply"/);
});

test("informational and confirmation-only cards keep their intended actions", () => {
  const card = s => renderCard({ s: { status: "pending", reason: "r", confidence: { level: "low", signals: [] }, ...s }, dispatch() {}, onAccept() {}, onAddSkill() {} });
  assert.doesNotMatch(card({ id: "n", category: "skill_not_demonstrated", skill: "Agile", applicable: false }), />Accept</);
  assert.match(card({ id: "m", category: "missing_skill", skill: "GCP", applicable: false }), /I have this skill/);
  assert.match(card({ id: "w", category: "weak_opener", applicable: true, suggested_text: "x", original_text: "y", target: { section: "experience" } }), />Accept</);
});

test("panel cards: accepting one leaves another pending card's Accept in place", async () => {
  const items = [
    { id: "s1", category: "weak_opener", applicable: true, original_text: "Worked on REST APIs with Flask", suggested_text: "Built REST APIs with Flask",
      target: { section: "experience", entry_index: 0, entry_id: "e1", field: "bullets", line_index: 0 } },
    { id: "s2", category: "weak_opener", applicable: true, original_text: "Made a dashboard for the support team", suggested_text: "Developed a dashboard for the support team",
      target: { section: "experience", entry_index: 0, entry_id: "e1", field: "bullets", line_index: 1 } },
    { id: "s3", category: "missing_skill", skill: "GCP", applicable: false },
  ].map(s => ({ ...s, severity: "medium", section: "Experience", reason: "r", confidence: { level: "medium", signals: [] } }));
  let st = suggestionsReducer(initialSuggestionsState, { type: "success", suggestions: items });
  const h = editor();
  // the panel's own accept path: applySuggestion → commit
  for (const id of ["s1", "s2"]) {
    const s = st.items.find(x => x.id === id);
    const r = applySuggestion(h.data, s, s.suggested_text);
    assert.equal(r.ok, true, id);
    st = suggestionsReducer(st, { type: "applying", id });
    await h.onCommit(r.data, describeChange(h.data, r.data));
    st = suggestionsReducer(st, { type: "accepted", id });
    const open = st.items.filter(isOpen);
    for (const o of open) {
      const html = renderCard({ s: o, dispatch() {}, onAccept() {}, onAddSkill() {} });
      assert.match(html, o.applicable ? />Accept</ : /I have this skill/, `${o.id} keeps its action after ${id}`);
    }
  }
  assert.deepEqual(st.items.map(s => s.status), ["accepted", "accepted", "pending"]);
  const r = addSkills(h.data, ["GCP"]);
  await h.onCommit(r.data, describeChange(h.data, r.data));
  assert.ok(h.saved.skills.technical.includes("GCP"));
  assert.deepEqual(h.saved.experience[0].bullets, ["Built REST APIs with Flask", "Developed a dashboard for the support team"]);
});
