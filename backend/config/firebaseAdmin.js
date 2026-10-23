const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

// Verifying a Firebase ID token only needs the Firebase project ID: the token's
// signature is checked against Google's public keys and its audience/issuer
// against this project. No service-account key is required for that. Previously
// the app was initialised with applicationDefault() alone, so on a machine without
// Google Cloud credentials every verification failed with
// "Unable to detect a Project Id in the current environment".
const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  "";

const options = {};
if (projectId) options.projectId = projectId;
// A service account is still used when one is configured (needed only for admin APIs).
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) options.credential = applicationDefault();

if (!projectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.warn(
    "⚠️  Firebase Admin: FIREBASE_PROJECT_ID is not set — Google sign-in will be rejected.\n" +
    "   Add FIREBASE_PROJECT_ID to backend/.env (same value as VITE_FIREBASE_PROJECT_ID in frontend/.env)."
  );
}

const firebaseApp =
  getApps().length === 0
    ? initializeApp(options)
    : getApps()[0];

const adminAuth = getAuth(firebaseApp);

module.exports = adminAuth;
