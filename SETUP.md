# Firebase Setup Guide — First Time

This is a step-by-step guide for Diogo. You only do this once.

---

## Step 1 — Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

---

## Step 2 — Create a Firebase project

1. Go to https://console.firebase.google.com/
2. Click **Add project**, name it (e.g. `rv-groceries`)
3. Disable Google Analytics (not needed)
4. Click **Continue** until the project is created

### Upgrade to Blaze (required for Cloud Functions)
- In the sidebar, click **Spark plan** → **Upgrade to Blaze**
- Enter a credit card. Free tier will cover 2 users easily (~$0/month)

---

## Step 3 — Firestore

1. Sidebar → **Firestore Database** → **Create database**
2. Choose **Production mode**
3. Choose a region (e.g. `europe-west1` for Portugal)
4. Click **Done**

---

## Step 4 — Authentication

1. Sidebar → **Authentication** → **Get started**
2. Click **Email/Password** → Enable it → Save
3. Go to **Users** tab → **Add user**
   - Email: `rv-app@yourdomain.com` (or any email you control)
   - Password: choose a strong password (this is NOT the PIN users see — store this in your password manager)

---

## Step 5 — Cloud Messaging (push notifications)

1. Sidebar → **Project Settings** → **Cloud Messaging** tab
2. Scroll to **Web Push certificates**
3. Click **Generate key pair** — copy the key (this is your VAPID key)

---

## Step 6 — Get your web app config

1. Sidebar → **Project Settings** → **General** → **Your apps** → **Add app** → Web (</> icon)
2. Register the app (no need to set up Hosting now)
3. Copy the `firebaseConfig` object — you'll need these values for your `.env` file

---

## Step 7 — Create your `.env` file

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in the values from your Firebase project:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=rv-groceries.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=rv-groceries
VITE_FIREBASE_STORAGE_BUCKET=rv-groceries.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef

# The Firebase Auth email+password you created in Step 4
VITE_APP_EMAIL=rv-app@yourdomain.com
VITE_APP_PASSWORD=your-firebase-auth-password

# The PIN users enter on the app. The sign-in screen is a numeric keypad, so this
# must be exactly 4 digits (to change the length, edit PIN_LENGTH in src/auth/AuthGate.tsx).
# In production the real value lives in the APP_PIN function secret, not here:
#   firebase functions:secrets:set APP_PIN
VITE_APP_PIN=1234

# The VAPID key from Step 5
VITE_FIREBASE_VAPID_KEY=BNxxxxxxxx...
```

---

## Step 8 — Update the FCM service worker

Open `public/firebase-messaging-sw.js` and replace the placeholder values with your
actual Firebase config values. This file runs in the background and cannot read `.env` vars.

---

## Step 9 — Initialize Firebase in this project

```bash
firebase init
```

Select (space to toggle, enter to confirm):
- **Firestore** ✓
- **Functions** ✓
- **Hosting** ✓

When prompted:
- Existing project → select your project
- Firestore rules file: `firestore.rules` (already exists)
- Firestore indexes file: `firestore.indexes.json` (already exists)
- Functions: **TypeScript**
- Hosting public dir: `dist`
- Single-page app: **Yes**
- Automatic GitHub deploys: **No** (set up later if you want)

---

## Step 10 — Build and deploy

```bash
npm run build
firebase deploy
```

This deploys:
- The PWA to Firebase Hosting
- Firestore rules
- Firestore indexes

You'll get a URL like `https://rv-groceries.web.app` — this is your app.

---

## Step 11 — Install on phones

1. Open the URL in Chrome on your phone
2. Tap the menu (⋮) → **Add to Home Screen**
3. Enter the PIN → pick your identity → allow notifications

Repeat on Alice's phone.

---

## Ongoing deploys

After any code change:
```bash
npm run build
firebase deploy --only hosting
```

---

## Troubleshooting

**App says "Connection error" on login:**
- Check your `VITE_APP_EMAIL` and `VITE_APP_PASSWORD` in `.env` match the Firebase Auth user

**Notifications not working:**
- Check that the VAPID key in `.env` matches Firebase → Project Settings → Cloud Messaging
- Notifications only work when the phone has internet

**Offline not working:**
- Make sure you installed the app (Add to Home Screen) — browser tabs don't cache as reliably
