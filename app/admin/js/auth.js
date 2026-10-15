// js/auth.js — admin auth guard
// Import in every protected page BEFORE any other logic.
// Redirects to login.html if not signed in or not an admin.

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const LOGIN_PAGE     = "/admin/login.html";
const DASHBOARD_PAGE = "/admin/dashboard.html";

/**
 * Call this at the top of every protected page.
 * Returns a Promise that resolves with the admin user object once verified.
 * Redirects to login if auth fails.
 *
 * @returns {Promise<{uid, email, name, isAdmin}>}
 */
export function requireAdmin() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        window.location.href = LOGIN_PAGE;
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (!snap.exists() || !snap.data()?.isAdmin) {
          await signOut(auth);
          window.location.href = LOGIN_PAGE + "?reason=unauthorized";
          return;
        }
        const data = snap.data();
        resolve({ uid: firebaseUser.uid, email: firebaseUser.email, name: data.name, isAdmin: true });
      } catch {
        window.location.href = LOGIN_PAGE + "?reason=error";
      }
    });
  });
}

export async function adminSignOut() {
  await signOut(auth);
  window.location.href = LOGIN_PAGE;
}
