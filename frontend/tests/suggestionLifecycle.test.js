// End-to-end-style tests for accepting / rejecting suggestions: resume data → commit (save or rollback) →
// live preview markup → "reload" from the saved copy. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import {
  addSkills, applyImprovement, applySuggestion, commitResumeChange, describeChange, improvementSkills,
  initialSuggestionsState, isOpen, rollbackChange, suggestionsReducer, unsupportedDurationClaims,
} from "../src/utils/suggestions.js";
import { loadPreviewRenderer } from "./renderPreview.js";

const render = await loadPreviewRenderer();
const ORDER = ["header", "summary", "skills", "experience", "projects", "education"];

const resume = () => ({
  name: "Aditi S", email: "aditi@example.com", summary: "",
  skills: { technical: ["Python", "React", "SQL"], soft: [] },
  experience: [{ id: "e1", title: "Software Engineering Intern", company: "Briddlee", startDate: "Jun 2025", endDate: "Aug 2025",
                 bullets: ["Worked on REST APIs with Flask and PostgreSQL"] }],
  projects: [{ id: "p1", name: "HireLens AI", description: "Made a resume matcher with NLP" }],
  education: [{ id: "d1", degree: "B.Tech Computer Science", institution: "XYZ University", endDate: "2026", gpa: "8.9",
                honors: "Relevant Coursework: Data Structures and Algorithms, Operating Systems, Software Development, Data Science" }],
});

/** A tiny in-memory editor + server, wired exactly like EditorPage: setData/getData + persist(). */
function harness({ failSave = false, stored = true } = {}) {
  let data = resume();
  const server = { saved: stored ? structuredClone(data) : null, calls: 0 };
  return {
    get data() { return data; },
    server,
    commit: (next) => commitResumeChange({
      next, change: describeChange(data, next),
      setData: d => { data = d; }, getData: () => data,
      notStoredReason: stored ? "" : "this resume isn't stored in your account",
      persist: async n => { server.calls++; if (failSave) throw Object.assign(new Error("Network Error"), { userMessage: "Server unreachable." }); server.saved = structuredClone(n); },
    }),
    reload() { data = structuredClone(server.saved); },
    edit(fn) { data = fn(data); },
  };
}

// ── The reported bug: "Applied" on a Skills tip without any change ─────────────────────────────
const SKILLS_TIP = { section: "Skills", type: "add_skills", suggestion: "The job asks for skills your resume doesn't mention: Docker, Large Language Models. Add one only if you have actually used it.",
                     skills: ["Docker", "Large Language Models"] };

test("applying a skill tip adds only the confirmed skill to the actual resume, preview and saved copy", async () => {
  const h = harness();
  const r = applyImprovement(h.data, SKILLS_TIP, { skills: ["Docker"] });
  assert.equal(r.ok, true);
  const res = await h.commit(r.data);
  assert.deepEqual(res, { saved: true, note: "" });
  assert.deepEqual(h.data.skills.technical, ["Python", "React", "SQL", "Docker"]);
  assert.ok(!h.data.skills.technical.includes("Large Language Models"), "unconfirmed job skill is not claimed");
  assert.match(render({ data: h.data, sectionOrder: ORDER }), /Docker/, "live preview shows the accepted skill");
  h.reload();
  assert.ok(h.data.skills.technical.includes("Docker"), "survives reload from the saved resume");
});

test("a skill tip with nothing confirmed changes nothing", () => {
  const r = applyImprovement(resume(), SKILLS_TIP, { skills: [] });
  assert.equal(r.ok, false);
  assert.equal(applyImprovement(resume(), SKILLS_TIP, { skills: ["Kubernetes"] }).ok, false, "only skills the tip names");
});

test("duplicate application never duplicates a skill (alias-aware)", async () => {
  const h = harness();
  await h.commit(applyImprovement(h.data, SKILLS_TIP, { skills: ["Docker"] }).data);
  const again = applyImprovement(h.data, SKILLS_TIP, { skills: ["docker"] });
  assert.equal(again.ok, false);
  assert.match(again.reason, /Already in your Skills/);
  assert.equal(addSkills(h.data, ["reactjs"]).ok, false, "React.js alias of existing React");
  assert.equal(h.data.skills.technical.filter(s => s.toLowerCase() === "docker").length, 1);
});

test("older analyses without a skills list still expose the skills individually", () => {
  assert.deepEqual(improvementSkills({ suggestion: "Add these in-demand skills to your profile: java, kubernetes" }), ["java", "kubernetes"]);
});

// ── Save failures never show a permanent "Applied" ─────────────────────────────────────────────
test("a failed save rolls the change back and throws (card shows failed + retry)", async () => {
  const h = harness({ failSave: true });
  const r = applyImprovement(h.data, SKILLS_TIP, { skills: ["Docker"] });
  await assert.rejects(h.commit(r.data), /undone.*Server unreachable/);
  assert.deepEqual(h.data.skills.technical, ["Python", "React", "SQL"], "editor no longer shows the unsaved skill");
  let st = suggestionsReducer({ ...initialSuggestionsState, items: [{ id: "s", status: "pending" }] }, { type: "applying", id: "s" });
  st = suggestionsReducer(st, { type: "commitFailed", id: "s", reason: "Couldn't save" });
  assert.equal(st.items[0].status, "failed");
  assert.ok(isOpen(st.items[0]), "failed suggestions stay open for retry");
  assert.equal(suggestionsReducer(st, { type: "accepted", id: "s" }).items[0].status, "accepted");
});

test("rollback never overwrites a field the user edited while the save was in flight", () => {
  const before = resume();
  const after = { ...before, summary: "New" };
  const change = describeChange(before, after);
  assert.deepEqual(change.keys, ["summary"]);
  assert.equal(rollbackChange(after, change).data.summary, "", "untouched → rolled back");
  const r = rollbackChange({ ...after, summary: "User typed more" }, change);
  assert.equal(r.data.summary, "User typed more");
  assert.deepEqual(r.conflicts, ["summary"]);
});

test("a resume that isn't stored is applied in the editor only, with an explicit note — no fake save", async () => {
  const h = harness({ stored: false });
  const res = await h.commit(applyImprovement(h.data, SKILLS_TIP, { skills: ["Docker"] }).data);
  assert.equal(res.saved, false);
  assert.match(res.note, /editor only/);
  assert.equal(h.server.calls, 0);
});

// ── Summary ───────────────────────────────────────────────────────────────────────────────────
const FABRICATED = { section: "Professional Summary", type: "summary_rewrite",
  suggestion: "Results-driven Technology Development Program Software Engineer with 3+ years of experience building scalable, high-performance applications." };

test("the stored '3+ years' summary cannot be applied to a resume that doesn't state it", () => {
  assert.deepEqual(unsupportedDurationClaims(FABRICATED.suggestion, resume()), ["3+ years"]);
  const r = applyImprovement(resume(), FABRICATED);
  assert.equal(r.ok, false);
  assert.match(r.reason, /3\+ years/);
});

test("accepting a grounded summary updates the Summary field (and only it), preview and save", async () => {
  const h = harness();
  const tip = { type: "summary_rewrite", suggestion: "Experience includes projects and internship work. Skills include Python, React and SQL." };
  const r = applyImprovement(h.data, tip);
  assert.deepEqual(describeChange(h.data, r.data).keys, ["summary"]);
  await h.commit(r.data);
  assert.equal(h.server.saved.summary, tip.suggestion);
  assert.match(render({ data: h.data, sectionOrder: ORDER }), /Experience includes projects and internship work/);
  assert.equal(applyImprovement(h.data, tip).ok, false, "re-applying the same summary is refused");
});

// ── Stale suggestions and reject ──────────────────────────────────────────────────────────────
test("a stale bullet suggestion cannot overwrite a newer user edit", () => {
  const tip = { type: "bullet_rewrite", original: "Worked on REST APIs with Flask and PostgreSQL", suggestion: "Developed REST APIs with Flask and PostgreSQL" };
  const ok = applyImprovement(resume(), tip);
  assert.deepEqual(ok.data.experience[0].bullets, ["Developed REST APIs with Flask and PostgreSQL"]);
  const edited = resume();
  edited.experience[0].bullets[0] = "Built and documented REST APIs with Flask";
  assert.equal(applyImprovement(edited, tip).ok, false);
  const s = { applicable: true, original_text: tip.original, suggested_text: tip.suggestion,
              target: { section: "experience", entry_index: 0, entry_id: "e1", field: "bullets", line_index: 0 } };
  assert.equal(applySuggestion(edited, s, s.suggested_text).ok, false);
});

test("rejecting only changes the suggestion's status — the resume is untouched", () => {
  const items = [{ id: "a", status: "pending" }, { id: "b", status: "pending" }];
  const st = suggestionsReducer({ ...initialSuggestionsState, status: "success", items }, { type: "reject", id: "a" });
  assert.deepEqual(st.items.map(s => s.status), ["rejected", "pending"]);
  assert.equal(isOpen(st.items[0]), false);
  assert.notEqual(st.items[0].status, "accepted", "rejected is distinct from applied");
});

test("re-analysis replaces suggestions but cannot touch resume data", () => {
  const st = suggestionsReducer({ ...initialSuggestionsState, items: [{ id: "a", status: "accepted" }] },
    { type: "success", suggestions: [{ id: "b", suggested_text: "x" }] });
  assert.deepEqual(st.items.map(s => [s.id, s.status]), [["b", "pending"]]);
  assert.equal("data" in st, false);
});

test("missing-skill suggestions need explicit confirmation before Add to Skills", () => {
  let st = suggestionsReducer({ ...initialSuggestionsState, items: [{ id: "m", status: "pending", category: "missing_skill", skill: "Large Language Models" }] },
    { type: "confirm", id: "m", value: true });
  assert.equal(st.items[0].confirmed, true);
  st = suggestionsReducer(st, { type: "confirm", id: "m", value: false });
  assert.equal(st.items[0].confirmed, false);
});

// ── Education coursework ────────────────────────────────────────────────────────────────────
test("education coursework renders in the preview / export markup from the resume data", () => {
  const html = render({ data: resume(), sectionOrder: ORDER });
  assert.match(html, /Relevant Coursework: Data Structures and Algorithms, Operating Systems, Software Development, Data Science/);
  assert.match(html, /B\.Tech Computer Science/);
});

test("multi-line education description renders one line each; empty description adds nothing", () => {
  const data = resume();
  data.education[0].honors = "Relevant Coursework: Operating Systems\n\nDean's List";
  const html = render({ data, sectionOrder: ORDER });
  assert.equal((html.match(/data-testid="education-detail"/g) || []).length, 2);
  data.education[0].honors = "  ";
  assert.doesNotMatch(render({ data, sectionOrder: ORDER }), /education-detail/);
  delete data.education[0].honors;
  assert.doesNotMatch(render({ data, sectionOrder: ORDER }), /education-detail|undefined/);
});

test("edited coursework survives save and reload and still renders", async () => {
  const h = harness();
  h.edit(d => ({ ...d, education: [{ ...d.education[0], honors: "Relevant Coursework: Compilers" }] }));
  await commitResumeChange({ next: h.data, change: { keys: [] }, setData: () => {}, getData: () => h.data,
    persist: async n => { h.server.saved = structuredClone(n); } });
  h.reload();
  assert.equal(h.data.education[0].honors, "Relevant Coursework: Compilers");
  assert.match(render({ data: h.data, sectionOrder: ORDER }), /Relevant Coursework: Compilers/);
});
