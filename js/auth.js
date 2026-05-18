import {
  auth,
  db,
  createUserWithEmailAndPassword,
  doc,
  onAuthStateChanged,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  getDoc
} from "./firebase.js";
import { state } from "./modules/state.js";

let authMode = "login"; // "login" or "signup"
let signupRole = "student"; // "student" or "rider"

let onUserChanged = () => {};
let showLoginScreen = () => {};

export function getCurrentUser() {
  return state.currentUser;
}

function getAuthValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function setAuthMessage(message, type = "error") {
  const authMessage = document.getElementById("authMessage");
  authMessage.innerText = message;
  authMessage.style.color = type === "success" ? "#86efac" : "#fca5a5";
}

function setAuthLoading(isLoading) {
  const submitBtn = document.getElementById("authSubmitBtn");
  submitBtn.disabled = isLoading;
  if (isLoading) {
    submitBtn.innerText = authMode === "signup" ? "Creating account..." : "Logging in...";
  } else {
    submitBtn.innerText = authMode === "signup" ? "Sign Up" : "Login";
  }
}

// Mock Matric Verification (Replace with real database check if available)
async function verifyMatricNumber(matricNo) {
  // For now, any matric number that isn't empty is "valid" 
  // but in a real app, we would check a 'validMatrics' collection
  if (!matricNo) return false;
  
  // Example of real check (commented out):
  /*
  const docRef = doc(db, "validMatrics", matricNo);
  const docSnap = await getDoc(docRef);
  return docSnap.exists();
  */
  
  return true; 
}

async function createAccount() {
  const name = getAuthValue("displayName");
  const email = getAuthValue("email");
  const password = getAuthValue("password");
  const phone = getAuthValue("phoneNumber");
  const matric = getAuthValue("matricNo");
  const plate = getAuthValue("plateNo");
  const vType = document.getElementById("vehicleType").value;

  // Regex Patterns
  const nameRegex = /^[a-zA-Z\s]{3,30}$/;
  const phoneRegex = /^\+?[0-9]{10,15}$/;
  const matricRegex = /^[A-Z0-9/-]{5,15}$/i; // Customize based on your university format
  const plateRegex = /^[A-Z0-9\s-]{4,10}$/i;

  // Validation
  if (!nameRegex.test(name)) return setAuthMessage("Enter a valid full name (3-30 letters).");
  if (!phoneRegex.test(phone)) return setAuthMessage("Enter a valid phone number (10-15 digits).");
  
  if (signupRole === "student") {
    if (!matricRegex.test(matric)) return setAuthMessage("Enter a valid Matric Number.");
    const isValidMatric = await verifyMatricNumber(matric);
    if (!isValidMatric) return setAuthMessage("Invalid matric number. Access denied.");
  } else {
    if (!plateRegex.test(plate)) return setAuthMessage("Enter a valid Plate Number.");
  }

  setAuthLoading(true);

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    const userData = {
      name,
      email,
      phone,
      role: signupRole,
      createdAt: serverTimestamp()
    };

    if (signupRole === "student") {
      userData.matricNo = matric.toUpperCase();
    } else {
      userData.plateNo = plate.toUpperCase();
      userData.vehicleType = vType;
    }

    await setDoc(doc(db, "users", credential.user.uid), userData);
    
    setAuthMessage("Account created successfully.", "success");
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

async function signIn() {
  const email = getAuthValue("email");
  const password = getAuthValue("password");

  if (!email || !password) return setAuthMessage("Enter email and password.");

  setAuthLoading(true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setAuthMessage("");
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Password should be at least 6 characters."
  };
  return messages[error.code] || error.message || "Authentication failed.";
}

// ================= GLOBAL BINDINGS =================
function setAuthMode(mode) {
  authMode = mode;
  const loginTab = document.getElementById("loginTab");
  const signupTab = document.getElementById("signupTab");
  const roleToggle = document.getElementById("roleToggle");
  const submitBtn = document.getElementById("authSubmitBtn");
  
  const fields = ["displayName", "phoneNumber", "matricNo", "riderFields"];
  
  if (mode === "login") {
    loginTab.classList.add("active");
    signupTab.classList.remove("active");
    roleToggle.classList.add("hidden");
    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) el.classList.add("hidden");
    });
    submitBtn.innerText = "Login";
  } else {
    loginTab.classList.remove("active");
    signupTab.classList.add("active");
    roleToggle.classList.remove("hidden");
    document.getElementById("displayName").classList.remove("hidden");
    document.getElementById("phoneNumber").classList.remove("hidden");
    setSignupRole(signupRole); // Refresh specific fields
    submitBtn.innerText = "Sign Up";
  }
  setAuthMessage("");
}

function setSignupRole(role) {
  signupRole = role;
  const studentBtn = document.getElementById("roleStudent");
  const riderBtn = document.getElementById("roleRider");
  const matricField = document.getElementById("matricNo");
  const riderFields = document.getElementById("riderFields");

  if (role === "student") {
    studentBtn.classList.add("active");
    riderBtn.classList.remove("active");
    matricField.classList.remove("hidden");
    if (riderFields) riderFields.classList.add("hidden");
  } else {
    studentBtn.classList.remove("active");
    riderBtn.classList.add("active");
    matricField.classList.add("hidden");
    if (riderFields) riderFields.classList.remove("hidden");
  }
}

function handleAuthSubmit() {
  if (authMode === "signup") {
    createAccount();
  } else {
    signIn();
  }
}

function continueAsGuest() {
  onUserChanged({ isGuest: true, role: 'student', displayName: 'Guest' });
}

async function logout() {
  if (window.cleanupRiderSession) {
    await window.cleanupRiderSession();
  }
  await signOut(auth);
  showLoginScreen();
}

// Bind to window immediately for HTML onclick handlers
export function bindAuthGlobals() {
  window.setAuthMode = setAuthMode;
  window.setSignupRole = setSignupRole;
  window.handleAuthSubmit = handleAuthSubmit;
  window.continueAsGuest = continueAsGuest;
  window.logout = logout;
}

export function initAuth(options) {
  onUserChanged = options.onUserChanged;
  showLoginScreen = options.showLoginScreen;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Fetch role from Firestore
      const userDoc = await getDoc(doc(db, "users", user.uid));
      let finalUser = user;
      if (userDoc.exists()) {
        const data = userDoc.data();
        finalUser = { ...user, ...data };
      }
      onUserChanged(finalUser);
    } else {
      onUserChanged(null);
    }
  });

  // Handle Enter key
  ["email", "password", "matricNo", "plateNo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAuthSubmit();
      });
    }
  });
}

// Bind globals immediately upon module load
bindAuthGlobals();
