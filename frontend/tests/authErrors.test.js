// Regression tests for Google sign-in error messages. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { describeGoogleSignInError, CANCELLED_CODES } from "../src/utils/authErrors.js";

const fb = code => Object.assign(new Error(`Firebase: Error (${code}).`), { code });

test("unauthorized domain names the domain and where to fix it", () => {
  const msg = describeGoogleSignInError(fb("auth/unauthorized-domain"), { hostname: "localhost" });
  assert.match(msg, /\(localhost\)/);
  assert.match(msg, /Authorized domains/);
});

test("common Firebase popup/config errors get specific messages", () => {
  assert.match(describeGoogleSignInError(fb("auth/popup-blocked")), /blocked the Google sign-in popup/);
  assert.match(describeGoogleSignInError(fb("auth/operation-not-allowed")), /Sign-in method → Google/);
  assert.match(describeGoogleSignInError(fb("auth/configuration-not-found")), /Authentication/);
  assert.match(describeGoogleSignInError(fb("auth/network-request-failed")), /network/);
  assert.match(describeGoogleSignInError(fb("auth/api-key-not-valid.-please-pass-a-valid-api-key.")), /VITE_FIREBASE_API_KEY/);
});

test("closing the popup is reported as a cancellation, not a failure", () => {
  assert.ok(CANCELLED_CODES.has("auth/popup-closed-by-user"));
  assert.match(describeGoogleSignInError(fb("auth/popup-closed-by-user")), /cancelled/);
});

test("backend verification errors are shown as returned by the server", () => {
  const err = { response: { status: 500, data: { code: "server_missing_project_id", error: "Google sign-in isn't configured on the server: FIREBASE_PROJECT_ID is missing" } } };
  assert.match(describeGoogleSignInError(err), /FIREBASE_PROJECT_ID/);
  assert.match(describeGoogleSignInError({ response: { status: 502, data: {} } }), /HTTP 502/);
});

test("backend unreachable is distinguished from a Firebase failure", () => {
  assert.match(describeGoogleSignInError({ request: {}, message: "Network Error" }), /backend running/);
});

test("missing frontend env vars are named (names only, no values)", () => {
  const err = Object.assign(new Error("Google sign-in isn't configured: VITE_FIREBASE_API_KEY missing from frontend/.env"), { code: "config/missing-env" });
  assert.match(describeGoogleSignInError(err), /VITE_FIREBASE_API_KEY missing/);
});

test("unknown errors still include the Firebase code", () => {
  assert.equal(describeGoogleSignInError(fb("auth/something-new")), "Google sign-in failed (auth/something-new).");
});
