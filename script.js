// script.js - Temporary version for login page

import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "./firebase.js";

console.log("Script loaded");

// Login function
window.login = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        alert("Please enter email and password");
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        console.log("Logged in:", userCredential.user.email);
        window.location.href = "dashboard.html";   // Redirect to dashboard
    } catch (error) {
        console.error(error);
        alert("Login failed: " + error.message);
    }
};

// Quick role (for testing without full auth)
window.quickRole = (role) => {
    localStorage.setItem("currentRole", role);
    window.location.href = "dashboard.html";
};

// Show signup alert for now
window.showSignup = () => {
    alert("Signup page coming soon.\n\nFor now, use Quick Role buttons below to test.");
};

// Logout function (will be used in dashboard)
window.logout = () => {
    window.location.href = "index.html";
};

console.log("Login functions ready");
