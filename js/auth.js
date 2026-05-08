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
  updateProfile
} from "./firebase.js";

let currentUser = null;
let isSignupMode = false;
let getCurrentRole = () => null;
let setCurrentRole = () => {};
let onUserChanged = () => {};
let showLoginScreen = () => {};
let showRoleSelect = () => {};

export function getCurrentUser() {
  return currentUser;
}

function getAuthValue(id) {
  return document.getElementById(id).value.trim();
}

function setAuthMessage(message, type = "error") {
  const authMessage = document.getElementById("authMessage");
  authMessage.innerText = message;
  authMessage.classList.toggle("success", type === "success");
}

function setAuthLoading(isLoading) {
  const submitBtn = document.getElementById("authSubmitBtn");
  const toggleBtn = document.getElementById("authToggleBtn");
  submitBtn.disabled = isLoading;
  toggleBtn.disabled = isLoading;
  submitBtn.innerText = isLoading
    ? (isSignupMode ? "Creating account..." : "Logging in...")
    : (isSignupMode ? "Create Account" : "Login");
}

function updateSignedInUI(user) {
  const userBadge = document.getElementById("userBadge");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!user) {
    userBadge.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    userBadge.innerText = "";
    return;
  }

  userBadge.innerText = user.displayName || user.email;
  userBadge.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
}

function authErrorMessage(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account. Try logging in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Use at least 6 characters for your password."
  };

  return messages[error.code] || error.message || "Something went wrong. Try again.";
}

async function createAccount() {
  const name = getAuthValue("displayName");
  const email = getAuthValue("email");
  const password = getAuthValue("password");

  if (!name) {
    setAuthMessage("Enter your full name.");
    return;
  }

  setAuthLoading(true);

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });

    try {
      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email,
        createdAt: serverTimestamp()
      });
    } catch (profileError) {
      console.warn("Profile save failed:", profileError);
    }

    setAuthMessage("Account created. Choose your role.", "success");
    showRoleSelect();
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

async function signIn() {
  const email = getAuthValue("email");
  const password = getAuthValue("password");

  setAuthLoading(true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
    setAuthMessage("");
    showRoleSelect();
  } catch (error) {
    setAuthMessage(authErrorMessage(error));
  } finally {
    setAuthLoading(false);
  }
}

function bindAuthGlobals() {
  window.continueAs = (role) => {
    currentUser = null;
    setCurrentRole(role);
    onUserChanged(null);
    showRoleSelect();
  };

  window.login = () => {
    if (isSignupMode) {
      createAccount();
    } else {
      signIn();
    }
  };

  window.showSignup = () => {
    isSignupMode = !isSignupMode;
    const displayName = document.getElementById("displayName");
    const password = document.getElementById("password");
    const submitBtn = document.getElementById("authSubmitBtn");
    const toggleBtn = document.getElementById("authToggleBtn");

    displayName.classList.toggle("hidden", !isSignupMode);
    password.autocomplete = isSignupMode ? "new-password" : "current-password";
    submitBtn.innerText = isSignupMode ? "Create Account" : "Login";
    toggleBtn.innerText = isSignupMode ? "Back to Login" : "Create New Account";
    setAuthMessage("");
  };

  window.logout = async () => {
    await signOut(auth);
    currentUser = null;
    setCurrentRole(null);
    onUserChanged(null);
    updateSignedInUI(null);
    showLoginScreen();
  };
}

export function initAuth(options) {
  getCurrentRole = options.getCurrentRole;
  setCurrentRole = options.setCurrentRole;
  onUserChanged = options.onUserChanged;
  showLoginScreen = options.showLoginScreen;
  showRoleSelect = options.showRoleSelect;

  bindAuthGlobals();

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    onUserChanged(user);
    updateSignedInUI(user);

    if (user && !getCurrentRole()) {
      showRoleSelect();
    }
  });

  ["displayName", "email", "password"].forEach((id) => {
    document.getElementById(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter") window.login();
    });
  });
}
