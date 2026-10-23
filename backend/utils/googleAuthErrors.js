/**
 * Maps a failure inside POST /api/auth/google-login to a status + a specific,
 * user-facing message. Messages never include the ID token or any credential.
 *
 * Returns { status, code, error } — `error` keeps the response shape the
 * frontend already reads (`response.data.error`); `code` identifies the cause.
 */
function describeGoogleAuthError(err) {
  const code = (err && (err.code || err.errorInfo?.code)) || "";
  const message = String((err && err.message) || "");

  if (/Unable to detect a Project Id|project id/i.test(message) && !/aud/i.test(message)) {
    return { status: 500, code: "server_missing_project_id",
      error: "Google sign-in isn't configured on the server: FIREBASE_PROJECT_ID is missing from backend/.env (use the same value as VITE_FIREBASE_PROJECT_ID)." };
  }
  if (code === "auth/id-token-expired") {
    return { status: 401, code: "token_expired", error: "Your Google sign-in expired before it reached the server. Please try again." };
  }
  if (code === "auth/id-token-revoked") {
    return { status: 401, code: "token_revoked", error: "This Google sign-in was revoked. Please sign in again." };
  }
  if (code === "auth/user-disabled") {
    return { status: 403, code: "user_disabled", error: "This Google account has been disabled in Firebase." };
  }
  if (/incorrect "aud"|incorrect "iss"|audience/i.test(message)) {
    return { status: 401, code: "project_mismatch",
      error: "The Google sign-in token was issued for a different Firebase project than the server expects. Make sure FIREBASE_PROJECT_ID (backend) matches VITE_FIREBASE_PROJECT_ID (frontend)." };
  }
  if (code === "auth/argument-error" || code === "auth/invalid-id-token") {
    return { status: 401, code: "invalid_token", error: "The server could not verify the Google sign-in token (it is malformed or not a Firebase ID token)." };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(message) || code === "app/network-error") {
    return { status: 503, code: "verification_unavailable",
      error: "The server couldn't reach Google to verify the sign-in (network problem). Please try again." };
  }
  if (err && (err.name === "MongoServerError" || err.name === "ValidationError" || err.name === "MongooseError")) {
    return { status: 500, code: "account_error", error: "Google sign-in was verified, but your account could not be created or updated." };
  }
  return { status: 401, code: code || "google_auth_failed", error: "Google authentication failed." };
}

module.exports = { describeGoogleAuthError };
