import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
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

import { Platform } from "react-native";

// Prevent re-initializing on hot reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);

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
