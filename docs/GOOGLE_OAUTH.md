# Google OAuth Setup — ResumeIQ AI v3

## Architecture Placeholder

The login/register pages include a functional Google button that shows setup instructions.
Full implementation requires one of the following:

## Option A: Firebase Authentication (Recommended)

1. Go to https://console.firebase.google.com → Create project "ResumeIQ"
2. Authentication → Sign-in method → Enable Google
3. `npm install firebase` in frontend
4. Create `src/services/firebase.js`:

```js
import{initializeApp}from"firebase/app";
import{getAuth,GoogleAuthProvider,signInWithPopup}from"firebase/auth";
const app=initializeApp({apiKey:"...",authDomain:"...",projectId:"..."});
const auth=getAuth(app);const provider=new GoogleAuthProvider();
export const signInWithGoogle=()=>signInWithPopup(auth,provider).then(r=>r.user);
```

5. Add `POST /api/auth/google` backend route to verify Firebase idToken and return JWT.

## Option B: Google OAuth 2.0

1. Google Cloud Console → Credentials → OAuth 2.0 Client ID
2. `npm install passport passport-google-oauth20` in backend
3. Add Google strategy, callback route, session handling.

## OTP Placeholder

Architecture reserved for future implementation:
- `POST /api/auth/otp/send` — send OTP to phone (Twilio)
- `POST /api/auth/otp/verify` — verify + return JWT
- Add `phone` field to User model when implementing.
