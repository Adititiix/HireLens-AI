// Regression tests for Google sign-in error handling (POST /api/auth/google-login).
// Firebase verification is stubbed — no network, no database, no real credentials.
const test = require("node:test");
const assert = require("node:assert/strict");
const { describeGoogleAuthError } = require("../utils/googleAuthErrors");
const adminAuth = require("../config/firebaseAdmin");
const { googleLogin } = require("../controllers/authController");

const FAKE_TOKEN = "eyJhbGciOiJSUzI1NiJ9.FAKE-ID-TOKEN-FOR-TESTS.signature";

function fakeRes() {
  return { statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
async function callWithVerifyError(error) {
  const original = adminAuth.verifyIdToken;
  const originalLog = console.error;
  const logged = [];
  adminAuth.verifyIdToken = async () => { throw error; };
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const res = fakeRes();
    await googleLogin({ body: { idToken: FAKE_TOKEN } }, res);
    return { res, logged: logged.join("\n") };
  } finally {
    adminAuth.verifyIdToken = original;
    console.error = originalLog;
  }
}
const fbError = (code, message) => Object.assign(new Error(message), { code });

test("missing project ID → 500 that names the missing setting", async () => {
  const { res } = await callWithVerifyError(new Error("Unable to detect a Project Id in the current environment."));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code, "server_missing_project_id");
  assert.match(res.body.error, /FIREBASE_PROJECT_ID/);
});

test("expired token → 401 token_expired", async () => {
  const { res } = await callWithVerifyError(fbError("auth/id-token-expired", "Firebase ID token has expired."));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "token_expired");
});

test("token from another Firebase project → 401 project_mismatch", async () => {
  const { res } = await callWithVerifyError(fbError("auth/argument-error",
    'Firebase ID token has incorrect "aud" (audience) claim. Expected "proj-a" but got "proj-b".'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "project_mismatch");
  assert.match(res.body.error, /VITE_FIREBASE_PROJECT_ID/);
});

test("malformed token → 401 invalid_token", async () => {
  const { res } = await callWithVerifyError(fbError("auth/argument-error", "Decoding Firebase ID token failed."));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "invalid_token");
});

test("the ID token never appears in the response or the server log", async () => {
  const { res, logged } = await callWithVerifyError(fbError("auth/id-token-expired", "Firebase ID token has expired."));
  assert.ok(!JSON.stringify(res.body).includes(FAKE_TOKEN));
  assert.ok(!logged.includes(FAKE_TOKEN));
  assert.match(logged, /token_expired/, "the cause is logged");
});

test("missing idToken → 400 before any verification", async () => {
  const res = fakeRes();
  await googleLogin({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("verification is never bypassed: a rejected token yields no JWT", async () => {
  const { res } = await callWithVerifyError(fbError("auth/argument-error", "Decoding Firebase ID token failed."));
  assert.equal(res.body.token, undefined);
});

test("network and database failures get distinct messages", () => {
  assert.equal(describeGoogleAuthError(new Error("getaddrinfo ENOTFOUND www.googleapis.com")).status, 503);
  assert.equal(describeGoogleAuthError(Object.assign(new Error("E11000 duplicate key"), { name: "MongoServerError" })).code, "account_error");
  assert.equal(describeGoogleAuthError(new Error("something else")).error, "Google authentication failed.");
});
