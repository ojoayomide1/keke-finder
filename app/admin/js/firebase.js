// js/firebase.js — shared Firebase init for admin panel
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain:        "keke-finder-cd5fe.firebaseapp.com",
  projectId:         "keke-finder-cd5fe",
  storageBucket:     "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId:             "1:836112236677:web:bd2a64d87f093a3230e9ec",
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
