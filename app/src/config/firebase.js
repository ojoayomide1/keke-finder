import { Platform } from "react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "firebase/app-check";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  limit,
  where,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "firebase/firestore";
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
  deleteUser
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

// Prevent re-initializing on hot reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// ─── APP CHECK ────────────────────────────────────────────────────────────────
// Required for Firebase AI Logic (Gemini Developer API).
// Web only — native App Check uses different providers (DeviceCheck / Play Integrity).
//
// Production: set EXPO_PUBLIC_RECAPTCHA_SITE_KEY in Vercel env vars.
// Development: the debug token is auto-printed to the browser console.
//   Copy it and register it at:
//   Firebase console → Security → App Check → Apps → Manage debug tokens
if (Platform.OS === "web") {
  try {
    const siteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY;
    if (siteKey) {
      // Production — reCAPTCHA v3
      initializeAppCheck(app, {
        provider:                new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } else {
      // Development — debug mode: prints a token to the console
      // Set the flag BEFORE initializeAppCheck
      if (typeof self !== "undefined") {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      // Use a placeholder site key — debug mode ignores it
      initializeAppCheck(app, {
        provider:                new ReCaptchaV3Provider("debug-placeholder"),
        isTokenAutoRefreshEnabled: false,
      });
    }
  } catch (e) {
    console.warn("[firebase] App Check init failed:", e.message);
  }
}

// Initialize Firestore with offline persistence.
// On web: use IndexedDB-backed persistent cache (multi-tab safe).
// On native: Firestore's React Native SDK handles persistence automatically,
//            so we fall back to getFirestore() to avoid double-init errors.
let db;
if (Platform.OS === "web") {
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // initializeFirestore throws if called after getFirestore() on hot reload
    db = getFirestore(app);
  }
} else {
  db = getFirestore(app);
}
export { db };
export { app };

// Platform-aware Auth Persistence (browserLocalPersistence on Web, AsyncStorage on Native)
let auth;
if (Platform.OS === "web") {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage)
    });
  } catch (e) {
    auth = getAuth(app);
  }
}

export { auth };

export {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  limit,
  where,
  serverTimestamp,
  runTransaction,
  writeBatch,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
  deleteUser
};
