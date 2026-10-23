/**
 * Turns a failure from the Google sign-in flow into a specific, actionable
 * message. Handles both stages:
 *   1. Firebase client (popup)            → error.code "auth/…"
 *   2. Backend token verification (axios) → error.response.data.{error,code}
 * Never includes tokens or API keys in the message.
 */
const FIREBASE_MESSAGES = {
  "auth/popup-closed-by-user":     "Google sign-in was cancelled (the popup was closed).",
  "auth/cancelled-popup-request":  "Google sign-in was cancelled because another sign-in popup was opened.",
  "auth/popup-blocked":            "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.",
  "auth/operation-not-allowed":    "Google sign-in is not enabled for this Firebase project. Enable it in Firebase Console → Authentication → Sign-in method → Google.",
  "auth/invalid-api-key":          "The Firebase API key is invalid. Check VITE_FIREBASE_API_KEY in frontend/.env, then restart the dev server.",
  "auth/api-key-not-valid":        "The Firebase API key is invalid. Check VITE_FIREBASE_API_KEY in frontend/.env, then restart the dev server.",
  "auth/configuration-not-found":  "Firebase Authentication isn't set up for this project. Open Firebase Console → Authentication and click Get started, then enable Google.",
  "auth/network-request-failed":   "Couldn't reach Google/Firebase (network error). Check your connection and try again.",
  "auth/too-many-requests":        "Too many sign-in attempts. Wait a moment and try again.",
  "auth/user-disabled":            "This Google account has been disabled in Firebase.",
  "auth/account-exists-with-different-credential": "An account with this email already exists with a different sign-in method.",
  "auth/web-storage-unsupported":  "This browser is blocking storage that Google sign-in needs (e.g. third-party cookies in private mode).",
  "auth/internal-error":           "Firebase returned an internal error during sign-in. Check the browser console for details and try again.",
};

/** Codes where the user simply backed out — show quietly, not as a failure. */
export const CANCELLED_CODES = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

export function describeGoogleSignInError(err, { hostname = "" } = {}) {
  // Stage 2: our backend answered (axios error with a response body).
  const data = err?.response?.data;
  if (data?.error) return data.error;
  if (err?.response) return `Google sign-in failed on the server (HTTP ${err.response.status}).`;
  if (err?.request && !err?.code?.startsWith?.("auth/")) {
    return "Couldn't reach the HireLens server to finish Google sign-in. Is the backend running?";
  }

  // Stage 1: Firebase client.
  const code = err?.code || "";
  if (code === "auth/unauthorized-domain") {
    return `This domain${hostname ? ` (${hostname})` : ""} isn't authorized for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (FIREBASE_MESSAGES[code]) return FIREBASE_MESSAGES[code];
  // Firebase v10+ reports a bad key as "auth/api-key-not-valid.-please-pass-a-valid-api-key."
  if (code.startsWith("auth/api-key-not-valid")) return FIREBASE_MESSAGES["auth/api-key-not-valid"];
  if (code === "config/missing-env") return err.message; // from services/firebase.js — names the missing variables only
  if (code) return `Google sign-in failed (${code}).`;
  return err?.message ? `Google sign-in failed: ${err.message}` : "Google sign-in failed.";
}
