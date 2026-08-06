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
import { showPromptDialog, dismissSplash } from "./modules/ui.js";
import {
  isBiometricsSupported,
  registerBiometrics,
  authenticateBiometrics,
  disableBiometrics
} from "./modules/biometrics.js";

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
  submitBtn.classList.toggle("loading", isLoading);
  if (isLoading) {
    submitBtn.innerText = authMode === "signup" ? "Creating account..." : "Logging in...";
  } else {
    submitBtn.innerText = authMode === "signup" ? "Sign Up" : "Login";
  }
}

// checking if the student's name and matric match what's in the db
async function verifyMatricNumber(name, matricNo) {
  if (!name || !matricNo) return false;
  try {
    // firestore doesn't allow slashes in doc IDs so replace them with dashes
    const sanitizedMatric = matricNo.trim().toUpperCase().replace(/\//g, '-');
    const docRef = doc(db, "authorized_students", sanitizedMatric);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      // name check is case-insensitive so "Ayomide" and "ayomide" both work
      return data.name.toLowerCase() === name.toLowerCase();
    }
    return false;
  } catch (error) {
    console.error("Error verifying matric:", error);
    return false;
  }
}

// same thing for riders, using plateNo as the doc ID
async function verifyRiderDetails(name, phone, plateNo) {
  if (!name || !phone || !plateNo) return false;
  try {
    // plate number is the doc ID for riders
    const docRef = doc(db, "authorized_riders", plateNo.toUpperCase());
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      // check both name and phone, last 10 digits of phone is enough
      const nameMatch = data.name.toLowerCase() === name.toLowerCase();
      const phoneMatch = data.phone.replace(/\D/g, '').endsWith(phone.replace(/\D/g, '').slice(-10));
      return nameMatch && phoneMatch;
    }
    return false;
  } catch (error) {
    console.error("Error verifying rider:", error);
    return false;
  }
}

async function createAccount() {
  const name = getAuthValue("displayName");
  const email = getAuthValue("email");
  const password = getAuthValue("password");
  const phone = getAuthValue("phoneNumber");
  const matric = getAuthValue("matricNo");
  const plate = getAuthValue("plateNo");
  const vType = document.getElementById("vehicleType").value;

  // patterns to validate input before even touching the db
  const nameRegex = /^[a-zA-Z\s.']{3,60}$/;
  const phoneRegex = /^\+?[0-9]{10,15}$/;
  const matricRegex = /^[A-Z0-9/-]{5,30}$/i; 
  const plateRegex = /^[A-Z0-9\s-]{4,15}$/i;

  // validate fields first before trying anything
  if (!nameRegex.test(name)) return setAuthMessage("Enter a valid full name (3-30 letters).");
  if (!phoneRegex.test(phone)) return setAuthMessage("Enter a valid phone number.");
  
  setAuthLoading(true);

  try {
    if (signupRole === "student") {
      if (!matricRegex.test(matric)) {
        setAuthLoading(false);
        return setAuthMessage("Enter a valid Matric Number.");
      }
      const isValidMatric = await verifyMatricNumber(name, matric);
      if (!isValidMatric) {
        setAuthLoading(false);
        return setAuthMessage("Name or Matric Number does not match our authorized records.");
      }
    } else {
      if (!plateRegex.test(plate)) {
        setAuthLoading(false);
        return setAuthMessage("Enter a valid Plate Number.");
      }
      const isValidRider = await verifyRiderDetails(name, phone, plate);
      if (!isValidRider) {
        setAuthLoading(false);
        return setAuthMessage("Rider details (Name, Phone, or Plate) do not match our authorized records.");
      }
    }

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    const userData = {
      name,
      email,
      phone,
      role: signupRole,
      createdAt: serverTimestamp()
    };
    console.log("Creating user with role:", signupRole);

    if (signupRole === "student") {
      userData.matricNo = matric.toUpperCase();
      userData.wallet = {
        balance: 0,
        currency: "NGN",
        lastTopUp: null,
        lastDeduction: null
      };
      userData.debt = {
        amount: 0,
        rideId: null,
        incurredAt: null
      };
    } else {
      userData.plateNo = plate.toUpperCase();
      userData.vehicleType = vType;
      userData.earnings = {
        balance: 0,
        totalEarned: 0,
        lastPayout: null
      };
    }

    try {
      console.log("Attempting to write user document to:", credential.user.uid);
      await setDoc(doc(db, "users", credential.user.uid), userData);
      console.log("User document successfully written.");
    } catch (dbError) {
      console.error("Firestore setDoc failed:", dbError);
      throw dbError; // bubble it up so the error shows in the ui
    }
    
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

// ===== GLOBAL BINDINGS =====
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
    setSignupRole(signupRole); // re-render the role-specific fields
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
async function logout() {
  if (window.cleanupRiderSession) {
    await window.cleanupRiderSession();
  }
  await signOut(auth);
  showLoginScreen();
}

// ===== BIOMETRICS =====
async function toggleBiometrics(enabled) {
  const user = state.currentUser;
  if (!user) {
    console.error("No active user session to enable biometrics.");
    return;
  }

  const studentToggle = document.getElementById("biometricsToggleStudent");
  const riderToggle = document.getElementById("biometricsToggleRider");
  const setToggleState = (val) => {
    if (studentToggle) studentToggle.checked = val;
    if (riderToggle) riderToggle.checked = val;
  };

  if (!isBiometricsSupported()) {
    if (window.showToast) window.showToast("Biometric authentication is not supported in this container.", "error");
    setToggleState(false);
    return;
  }

  if (enabled) {
    const password = await showPromptDialog({
      title: "Secure Biometrics",
      message: "Enter your account password to secure biometrics:",
      placeholder: "Enter password",
      inputType: "password"
    });
    if (!password) {
      setToggleState(false);
      return;
    }

    try {
      if (window.showToast) window.showToast("Initiating biometric scan...", "info");
      const success = await registerBiometrics(user.email, password, user.displayName);
      if (success) {
        setToggleState(true);
        if (window.showToast) window.showToast("Biometric login activated!", "success");
        updateBiometricsUI();
      } else {
        setToggleState(false);
      }
    } catch (err) {
      console.error(err);
      if (window.showToast) window.showToast(err.message || "Failed to set up biometrics", "error");
      setToggleState(false);
    }
  } else {
    disableBiometrics();
    setToggleState(false);
    if (window.showToast) window.showToast("Biometric login deactivated.", "info");
    updateBiometricsUI();
  }
}

async function handleBiometricLogin() {
  try {
    if (window.showToast) window.showToast("Confirm your biometrics...", "info");
    const credentials = await authenticateBiometrics();
    if (credentials && credentials.email && credentials.password) {
      setAuthLoading(true);
      await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
      setAuthMessage("");
      if (window.showToast) window.showToast("Authenticated successfully!", "success");
    }
  } catch (err) {
    console.error(err);
    if (window.showToast) window.showToast(err.message || "Biometric verification failed", "error");
    setAuthLoading(false);
  }
}

function updateBiometricsUI() {
  const isSupported = isBiometricsSupported();
  const studentItem = document.getElementById("biometricsSettingItemStudent");
  const riderItem = document.getElementById("biometricsSettingItemRider");
  const studentToggle = document.getElementById("biometricsToggleStudent");
  const riderToggle = document.getElementById("biometricsToggleRider");
  const biometricLoginBtn = document.getElementById("biometricLoginBtn");

  if (studentItem) {
    studentItem.classList.remove("hidden");
    if (!isSupported) {
      studentItem.style.opacity = "0.6";
      const small = studentItem.querySelector("small");
      if (small) small.innerText = "Not supported in this container (Use Safari/Chrome)";
      if (studentToggle) studentToggle.disabled = true;
    } else {
      studentItem.style.opacity = "1";
      const small = studentItem.querySelector("small");
      if (small) small.innerText = "Use Face ID / Fingerprint to log in";
      if (studentToggle) studentToggle.disabled = false;
    }
  }

  if (riderItem) {
    riderItem.classList.remove("hidden");
    if (!isSupported) {
      riderItem.style.opacity = "0.6";
      const small = riderItem.querySelector("small");
      if (small) small.innerText = "Not supported in this container (Use Safari/Chrome)";
      if (riderToggle) riderToggle.disabled = true;
    } else {
      riderItem.style.opacity = "1";
      const small = riderItem.querySelector("small");
      if (small) small.innerText = "Use Face ID / Fingerprint to log in";
      if (riderToggle) riderToggle.disabled = false;
    }
  }

  if (isSupported) {
    const isEnabled = localStorage.getItem("oprBiometricsEnabled") === "true";
    if (studentToggle) studentToggle.checked = isEnabled;
    if (riderToggle) riderToggle.checked = isEnabled;
    if (biometricLoginBtn) {
      biometricLoginBtn.classList.toggle("hidden", !isEnabled);
    }
  } else {
    if (studentToggle) studentToggle.checked = false;
    if (riderToggle) riderToggle.checked = false;
    if (biometricLoginBtn) {
      biometricLoginBtn.classList.add("hidden");
    }
  }
}

// toggle the show/hide password button
function togglePasswordVisibility(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const icon = el.parentElement.querySelector(".password-toggle-btn i");
  if (el.type === "password") {
    el.type = "text";
    if (icon) icon.className = "fas fa-eye-slash";
  } else {
    el.type = "password";
    if (icon) icon.className = "fas fa-eye";
  }
}

// bind to window right away so html onclick attributes work
export function bindAuthGlobals() {
  window.setAuthMode = setAuthMode;
  window.setSignupRole = setSignupRole;
  window.handleAuthSubmit = handleAuthSubmit;
  window.logout = logout;
  window.toggleBiometrics = toggleBiometrics;
  window.handleBiometricLogin = handleBiometricLogin;
  window.togglePasswordVisibility = togglePasswordVisibility;
}

export function initAuth(options) {
  onUserChanged = options.onUserChanged;
  showLoginScreen = options.showLoginScreen;

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // pull role from firestore, not just from the auth token
      let userDoc = await getDoc(doc(db, "users", user.uid));
      
      // retry once after a second, sometimes the doc isn't ready instantly after signup
      if (!userDoc.exists()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        userDoc = await getDoc(doc(db, "users", user.uid));
      }

      let finalUser = user;
      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log("User document fetched:", data);
        finalUser = { ...user, ...data };
        onUserChanged(finalUser);
      } else {
        // still no doc? might be guest or doc is still being written, call onUserChanged anyway
        onUserChanged(user);
      }
      dismissSplash();
      updateBiometricsUI();
    } else {
      onUserChanged(null);
      dismissSplash();
      updateBiometricsUI();
    }
  });

  // press enter to submit — basic UX stuff
  ["email", "password", "matricNo", "plateNo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAuthSubmit();
      });
    }
  });

  // set up biometrics toggle on init
  updateBiometricsUI();
}

// bind as soon as module loads
bindAuthGlobals();

// also re-bind after DOM is ready just to be safe
window.addEventListener('DOMContentLoaded', bindAuthGlobals);
