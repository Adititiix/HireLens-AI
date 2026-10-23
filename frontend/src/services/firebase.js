import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Required for Google sign-in. Names only are ever reported — never values.
const REQUIRED = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  appId: "VITE_FIREBASE_APP_ID",
};
const missing = Object.entries(REQUIRED).filter(([k]) => !firebaseConfig[k]).map(([, name]) => name);

// Initialise only with a complete config: getAuth() throws at import time on a
// missing API key, which used to take the whole Login page down with it.
const app = missing.length ? null : initializeApp(firebaseConfig);

export const auth = app ? getAuth(app) : null;

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export const signInWithGoogle = () => {
  if (!auth) {
    const err = new Error(`Google sign-in isn't configured: ${missing.join(", ")} missing from frontend/.env (restart the dev server after adding).`);
    err.code = "config/missing-env";
    return Promise.reject(err);
  }
  return signInWithPopup(auth, googleProvider);
};
