// Gateway tests for POST /api/resume/suggestions (NLP service stubbed — no network).
const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const { getSuggestions } = require("../controllers/suggestionController");

function fakeRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
async function call(body, stub) {
  const original = axios.post, originalErr = console.error;
  const calls = [];
  axios.post = async (url, payload, opts) => { calls.push({ url, payload, opts }); return stub(payload); };
  console.error = () => {};
  try { const res = fakeRes(); await getSuggestions({ body }, res); return { res, calls }; }
  finally { axios.post = original; console.error = originalErr; }
}
const RESUME = { experience: [{ title: "Intern", bullets: ["Worked on the billing API."] }] };

test("forwards structured resume + JD to the NLP service with snake_case fields", async () => {
  const { res, calls } = await call({ resume: RESUME, jobDescription: "Python role", maxSuggestions: 5 },
    async () => ({ data: { suggestions: [{ id: "a" }], summary: { total: 1 }, engine: { generative_model: false } } }));
  assert.equal(calls[0].url.endsWith("/resume-suggestions"), true);
  assert.deepEqual(calls[0].payload, { resume: RESUME, resume_text: "", job_description: "Python role", analysis: undefined, max_suggestions: 5 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.suggestions.length, 1);
});

test("rejects requests without resume content before calling the NLP service", async () => {
  const { res, calls } = await call({ jobDescription: "x" }, async () => ({ data: {} }));
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
  const r2 = await call({ resume: "text", resumeText: "  " }, async () => ({ data: {} }));
  assert.equal(r2.res.statusCode, 400);
});

test("rejects a non-text job description and oversized bodies", async () => {
  assert.equal((await call({ resume: RESUME, jobDescription: { a: 1 } }, async () => ({ data: {} }))).res.statusCode, 400);
  assert.equal((await call({ resumeText: "x".repeat(310_000) }, async () => ({ data: {} }))).res.statusCode, 413);
});

test("NLP 422 → 400 with field messages only (resume content is never echoed back)", async () => {
  const err = Object.assign(new Error("422"), { response: { status: 422, data: { detail: [
    { loc: ["body", "resume_text"], msg: "String should have at most 60000 characters", input: "SECRET RESUME TEXT" }] } } });
  const { res } = await call({ resumeText: "abc" }, async () => { throw err; });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.details, [{ field: "resume_text", message: "String should have at most 60000 characters" }]);
  assert.ok(!JSON.stringify(res.body).includes("SECRET"));
});

test("NLP service down → 503 with a clear message", async () => {
  const { res } = await call({ resume: RESUME }, async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /NLP service/);
});

test("NLP internal error → 502 without internal details", async () => {
  const { res } = await call({ resume: RESUME }, async () => { throw Object.assign(new Error("500"), { response: { status: 500, data: { detail: "trace..." } } }); });
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes("trace"));
});
