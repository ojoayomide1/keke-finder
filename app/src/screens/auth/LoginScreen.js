/**
 * LoginScreen.js
 *
 * Email/password login + signup, with biometric quick-login.
 * Biometric button appears first when biometrics are available.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "../../config/firebase";

import {
  isBiometricsAvailable,
  isBiometricsEnabled,
  getBiometricLabel,
  registerBiometrics,
  authenticateBiometrics,
} from "../../services/biometrics";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calculateLevelFromMatric(matricNo, baseYear = 25) {
  if (!matricNo) return "100L";
  const match = matricNo.match(/[\/\-_](\d{2})[\/\-_]/);
  if (match) {
    const yr = parseInt(match[1], 10);
    const diff = (baseYear - yr) + 1;
    if (diff >= 1 && diff <= 6) return `${diff * 100}L`;
  }
  return "100L";
}

async function verifyMatricNumber(name, matricNo) {
  if (!name || !matricNo) return false;
  try {
    const sanitized = matricNo.trim().toUpperCase().replace(/\//g, "-");
    const snap = await getDoc(doc(db, "authorized_students", sanitized));
    if (snap.exists()) {
      const data = snap.data();
      if (data.name.toLowerCase() === name.toLowerCase()) {
        return data;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function verifyRiderDetails(name, phone, plateNo) {
  if (!name || !phone || !plateNo) return false;
  try {
    const snap = await getDoc(doc(db, "authorized_riders", plateNo.toUpperCase()));
    if (snap.exists()) {
      const d = snap.data();
      const nameMatch  = d.name.toLowerCase() === name.toLowerCase();
      const phoneMatch = d.phone.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-10));
      return nameMatch && phoneMatch;
    }
    return false;
  } catch {
    return false;
  }
}

function authErrorMessage(error) {
  const map = {
    "auth/email-already-in-use": "That email already has an account.",
    "auth/invalid-email":        "Enter a valid email address.",
    "auth/invalid-credential":   "Email or password is incorrect.",
    "auth/missing-password":     "Enter your password.",
    "auth/weak-password":        "Password should be at least 6 characters.",
  };
  return map[error.code] ?? error.message ?? "Authentication failed.";
}

// ─── FEATURE FLAG ────────────────────────────────────────────────────────────
// Set to true to re-enable registration when NavCamp officially launches.
const REGISTRATION_OPEN = false;

export default function LoginScreen() {
  const [mode, setMode] = useState("login");    // "login" | "signup"
  const [role, setRole] = useState("student"); // "student" | "rider"
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [error, setError] = useState("");         // login errors
  const [fieldErrors, setFieldErrors] = useState({}); // signup per-field errors

  function fieldErr(field, msg) {
    setFieldErrors(prev => ({ ...prev, [field]: msg }));
  }
  function clearFieldErr(field) {
    setFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  }

  // Biometric state
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLabel,     setBioLabel]     = useState("Biometrics");

  // Fields
  const [name,        setName]        = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone,       setPhone]       = useState("");
  const [matric,      setMatric]      = useState("");
  const [plate,       setPlate]       = useState("");
  const [vehicleType, setVehicleType] = useState("keke");

  // ── Check biometric state on mount ────────────────────────────────────────
  // Run all three checks in parallel so we don't wait 3× as long.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [available, enabled, label] = await Promise.all([
        isBiometricsAvailable(),
        isBiometricsEnabled(),
        getBiometricLabel(),
      ]);
      if (cancelled) return;
      setBioAvailable(available);
      setBioEnabled(enabled);
      setBioLabel(label);

      // Auto-trigger immediately — no artificial delay
      if (available && enabled && mode === "login") {
        handleBiometricLogin();
      }
    })();
    return () => { cancelled = true; };
  }, [mode]); // Re-run when mode changes

  // ── Biometric quick-login ─────────────────────────────────────────────────
  async function handleBiometricLogin() {
    setBioLoading(true);
    setError("");
    try {
      const { email: savedEmail, password: savedPassword } = await authenticateBiometrics();
      await signInWithEmailAndPassword(auth, savedEmail, savedPassword);
    } catch (e) {
      setError(e.message || "Biometric login failed.");
    } finally {
      setBioLoading(false);
    }
  }

  // ── Email/password login ──────────────────────────────────────────────────
  async function handleLogin() {
    if (!email || !password) return setError("Enter email and password.");
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);

      // After successful login, offer to enable biometrics if available + not yet set up
      const available = await isBiometricsAvailable();
      const enabled   = await isBiometricsEnabled();
      if (available && !enabled) {
        setTimeout(() => {
          Alert.alert(
            "Enable Biometrics?",
            "Log in faster next time without entering your password.",
            [
              { text: "Not now", style: "cancel" },
              {
                text: "Enable Biometrics",
                onPress: async () => {
                  try {
                    await registerBiometrics(email, password);
                    setBioEnabled(true);
                    await signInWithEmailAndPassword(auth, email, password);
                  } catch (e) {
                    setError(e.message || "Failed to enable biometrics");
                  } finally {
                    setLoading(false);
                  }
                },
              },
            ]
          );
        }, 600);
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Signup ────────────────────────────────────────────────────────────────
  async function handleSignup() {
    // Nigerian phone: 11 digits starting with 0, or +234 followed by 10 digits
    const phoneRegex  = /^(0[7-9][0-1]\d{8}|\+?234[7-9][0-1]\d{8})$/;
    const plateRegex  = /^[A-Z0-9\s-]{4,15}$/i;

    // Validate all fields inline — collect errors, don't return on first fail
    const errs = {};
    if (!name.trim() || name.trim().length < 3) errs.name = "Enter your full name (at least 3 characters).";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    if (!phone.trim() || !phoneRegex.test(phone.replace(/\s/g, ""))) errs.phone = "Enter a valid Nigerian phone number (e.g. 08012345678 or +2348012345678).";
    if (role === "student" && !matric.trim()) errs.matric = "Enter your matric number.";
    if (role === "rider" && (!plate.trim() || !plateRegex.test(plate))) errs.plate = "Enter a valid plate number.";

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    setError("");

    try {
      let studentRecord = null;
      if (role === "student") {
        studentRecord = await verifyMatricNumber(name, matric);
        if (!studentRecord) {
          setLoading(false);
          setFieldErrors({ matric: "Name or matric number does not match our records." });
          return;
        }
      } else {
        const valid = await verifyRiderDetails(name, phone, plate);
        if (!valid) {
          setLoading(false);
          setFieldErrors({ plate: "Rider details do not match our authorized records." });
          return;
        }
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });

      const userData = {
        name,
        email,
        phone,
        role,
        createdAt: serverTimestamp(),
      };

      if (role === "student") {
        userData.matricNo   = matric.toUpperCase();
        userData.level      = (studentRecord && studentRecord.level) || calculateLevelFromMatric(matric);
        userData.department = (studentRecord && studentRecord.department) || null;
        userData.wallet     = { balance: 0, currency: "NGN", lastTopUp: null, lastDeduction: null };
        userData.debt       = { amount: 0, rideId: null, incurredAt: null };
      } else {
        userData.plateNo     = plate.toUpperCase();
        userData.vehicleType = vehicleType;
        userData.earnings    = { balance: 0, totalEarned: 0, lastPayout: null };
      }

      await setDoc(doc(db, "users", cred.user.uid), userData);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "web" ? undefined : (Platform.OS === "ios" ? "padding" : "height")}
      keyboardVerticalOffset={Platform.OS === "android" ? 0 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Brand ───────────────────────────────────────────── */}
        <View style={styles.brand}>
          <Text style={styles.brandText}>
            <Text style={styles.brandNav}>Nav</Text>
            <Text style={styles.brandCamp}>Camp</Text>
          </Text>
          <Text style={styles.tagline}>Let's move smarter.</Text>
        </View>

        {/* ── Biometric quick-login button (always first when available) ── */}
        {mode === "login" && bioAvailable && (
          <TouchableOpacity
            style={[styles.bioBtn, bioLoading && styles.bioBtnDisabled]}
            onPress={handleBiometricLogin}
            disabled={bioLoading}
            activeOpacity={0.8}
          >
            {bioLoading ? (
              <ActivityIndicator color="#F7F8FA" />
            ) : (
              <Text style={styles.bioBtnText}>Log in with Biometrics</Text>
            )}
          </TouchableOpacity>
        )}

        {/* ── Login / Sign Up tabs ─────────────────────────────── */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => { setMode("login"); setError(""); setFieldErrors({}); }}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>
              Login
            </Text>
          </TouchableOpacity>
          {REGISTRATION_OPEN && (
            <TouchableOpacity
              style={[styles.tab, mode === "signup" && styles.tabActive]}
              onPress={() => { setMode("signup"); setError(""); setFieldErrors({}); }}
            >
              <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>
                Sign Up
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Launch notice — shown when registration is closed ── */}
        {!REGISTRATION_OPEN && (
          <View style={styles.launchBanner}>
            <Text style={styles.launchTitle}>🚀 NavCamp launches Sunday, Oct 25</Text>
            <Text style={styles.launchSub}>
              Registration opens on launch day.{"\n"}
              Learn more at{" "}
              <Text
                style={styles.launchLink}
                onPress={() => require("react-native").Linking.openURL("https://navcamp.site")}
              >
                navcamp.site
              </Text>
            </Text>
          </View>
        )}

        {/* ── Role toggle — signup only ────────────────────────── */}
        {mode === "signup" && (
          <View style={styles.roleRow}>
            {["student", "rider"].map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.roleBtn, role === r && styles.roleBtnActive]}
                onPress={() => setRole(r)}
              >
                <Text style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Fields ──────────────────────────────────────────── */}
        <View style={styles.form}>
          {mode === "signup" && (
            <View>
              <TextInput
                style={[styles.input, fieldErrors.name && styles.inputError]}
                placeholder="Full Name"
                placeholderTextColor="#6B7280"
                value={name}
                onChangeText={v => { setName(v); clearFieldErr("name"); }}
                autoCapitalize="words"
              />
              {fieldErrors.name ? <Text style={styles.fieldError}>{fieldErrors.name}</Text> : null}
            </View>
          )}

          <View>
            <TextInput
              style={[styles.input, fieldErrors.email && styles.inputError]}
              placeholder="Email"
              placeholderTextColor="#6B7280"
              value={email}
              onChangeText={v => { setEmail(v); clearFieldErr("email"); }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {fieldErrors.email ? <Text style={styles.fieldError}>{fieldErrors.email}</Text> : null}
          </View>

          <View>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput, fieldErrors.password && styles.inputError]}
                placeholder="Password"
                placeholderTextColor="#6B7280"
                value={password}
                onChangeText={v => { setPassword(v); clearFieldErr("password"); }}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.eyeText}>{showPassword ? "🙈" : "👁️"}</Text>
              </TouchableOpacity>
            </View>
            {fieldErrors.password
              ? <Text style={styles.fieldError}>{fieldErrors.password}</Text>
              : mode === "signup" && password.length > 0 && password.length < 8
                ? <Text style={styles.fieldHint}>At least 8 characters needed ({password.length}/8)</Text>
                : null
            }
          </View>

          {mode === "signup" && (
            <View>
              <TextInput
                style={[styles.input, fieldErrors.phone && styles.inputError]}
                placeholder="Phone Number (e.g. 08012345678)"
                placeholderTextColor="#6B7280"
                value={phone}
                onChangeText={v => { setPhone(v); clearFieldErr("phone"); }}
                keyboardType="phone-pad"
              />
              {fieldErrors.phone ? <Text style={styles.fieldError}>{fieldErrors.phone}</Text> : null}
            </View>
          )}

          {mode === "signup" && role === "student" && (
            <View>
              <TextInput
                style={[styles.input, fieldErrors.matric && styles.inputError]}
                placeholder="Matric Number (e.g. VUG/CSC/25/14902)"
                placeholderTextColor="#6B7280"
                value={matric}
                onChangeText={v => { setMatric(v); clearFieldErr("matric"); }}
                autoCapitalize="characters"
              />
              {fieldErrors.matric ? <Text style={styles.fieldError}>{fieldErrors.matric}</Text> : null}
            </View>
          )}

          {mode === "signup" && role === "rider" && (
            <>
              <View>
                <TextInput
                  style={[styles.input, fieldErrors.plate && styles.inputError]}
                  placeholder="Plate Number"
                  placeholderTextColor="#6B7280"
                  value={plate}
                  onChangeText={v => { setPlate(v); clearFieldErr("plate"); }}
                  autoCapitalize="characters"
                />
                {fieldErrors.plate ? <Text style={styles.fieldError}>{fieldErrors.plate}</Text> : null}
              </View>
              <View style={styles.vehicleRow}>
                {["keke", "shuttle"].map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.vehicleBtn, vehicleType === v && styles.vehicleBtnActive]}
                    onPress={() => setVehicleType(v)}
                  >
                    <Text style={[styles.vehicleBtnText, vehicleType === v && styles.vehicleBtnTextActive]}>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </View>

        {/* ── Error ───────────────────────────────────────────── */}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* ── Submit ──────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={mode === "login" ? handleLogin : handleSignup}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#F7F8FA" />
            : <Text style={styles.submitBtnText}>
                {mode === "login" ? "Login" : "Sign Up"}
              </Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F7F8FA" },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 80 },

  brand:      { alignItems: "center", marginBottom: 36 },
  brandText:  { fontSize: 42, fontWeight: "800", letterSpacing: -1 },
  brandNav:   { color: "#0F1117" },
  brandCamp:  { color: "#1E7A46" },
  tagline:    { color: "#6B7280", marginTop: 6, fontSize: 15 },

  bioBtn: {
    alignItems:       "center",
    justifyContent:   "center",
    backgroundColor:  "#FFFFFF",
    borderRadius:     14,
    paddingVertical:  15,
    borderWidth:      1,
    borderColor:      "#1E7A46",
    marginBottom:     16,
  },
  bioBtnDisabled: { opacity: 0.5 },
  bioBtnText:     { color: "#1E7A46", fontWeight: "700", fontSize: 15 },

  tabs:          { flexDirection: "row", backgroundColor: "#FFFFFF", borderRadius: 12, padding: 4, marginBottom: 20 },
  tab:           { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 9 },
  tabActive:     { backgroundColor: "#1E7A46" },
  tabText:       { color: "#6B7280", fontWeight: "600" },
  tabTextActive: { color: "#F7F8FA" },

  roleRow:          { flexDirection: "row", gap: 10, marginBottom: 16 },
  roleBtn:          { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#E2E6ED" },
  roleBtnActive:    { borderColor: "#1E7A46", backgroundColor: "rgba(30,122,70,0.08)" },
  roleBtnText:      { color: "#6B7280", fontWeight: "600" },
  roleBtnTextActive:{ color: "#1E7A46" },

  form:  { gap: 12, marginBottom: 8 },
  input: {
    backgroundColor:   "#FFFFFF",
    borderRadius:      12,
    paddingHorizontal: 16,
    paddingVertical:   14,
    color:             "#0F1117",
    fontSize:          15,
    borderWidth:       1,
    borderColor:       "#E2E6ED",
  },

  // Password field with eye toggle
  passwordRow: {
    position:  "relative",
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: 50,  // make room for eye icon
  },
  eyeBtn: {
    position:   "absolute",
    right:      14,
    top:        0,
    bottom:     0,
    justifyContent: "center",
    alignItems:     "center",
  },
  eyeText: { fontSize: 18 },

  vehicleRow:          { flexDirection: "row", gap: 10 },
  vehicleBtn:          { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#E2E6ED" },
  vehicleBtnActive:    { borderColor: "#1E7A46", backgroundColor: "rgba(30,122,70,0.08)" },
  vehicleBtnText:      { color: "#6B7280", fontWeight: "600" },
  vehicleBtnTextActive:{ color: "#1E7A46" },

  error:      { color: "#C23B3B", textAlign: "center", marginVertical: 8, fontSize: 13 },
  fieldError: { color: "#C23B3B", fontSize: 12, marginTop: 4, marginBottom: 4, paddingHorizontal: 2 },
  fieldHint:  { color: "#6B7280", fontSize: 12, marginTop: 4, marginBottom: 4, paddingHorizontal: 2 },
  inputError: { borderColor: "#C23B3B" },

  launchBanner: {
    backgroundColor: "#E6F2EB",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#1E7B4C40",
    padding:         16,
    marginBottom:    16,
    alignItems:      "center",
    gap:             6,
  },
  launchTitle: { color: "#14171A", fontSize: 15, fontWeight: "600", textAlign: "center" },
  launchSub:   { color: "#5B6470", fontSize: 13, textAlign: "center", lineHeight: 20 },
  launchLink:  { color: "#1E7B4C", fontWeight: "600", textDecorationLine: "underline" },

  submitBtn:         { backgroundColor: "#1E7A46", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 12 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText:     { color: "#F7F8FA", fontWeight: "700", fontSize: 16 },
});



