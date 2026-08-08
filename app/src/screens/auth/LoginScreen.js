import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Mirrors verifyMatricNumber from old auth.js
async function verifyMatricNumber(name, matricNo) {
  if (!name || !matricNo) return false;
  try {
    const sanitized = matricNo.trim().toUpperCase().replace(/\//g, "-");
    const snap = await getDoc(doc(db, "authorized_students", sanitized));
    if (snap.exists()) {
      return snap.data().name.toLowerCase() === name.toLowerCase();
    }
    return false;
  } catch {
    return false;
  }
}

// Mirrors verifyRiderDetails from old auth.js
async function verifyRiderDetails(name, phone, plateNo) {
  if (!name || !phone || !plateNo) return false;
  try {
    const snap = await getDoc(doc(db, "authorized_riders", plateNo.toUpperCase()));
    if (snap.exists()) {
      const d = snap.data();
      const nameMatch = d.name.toLowerCase() === name.toLowerCase();
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
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/missing-password": "Enter your password.",
    "auth/weak-password": "Password should be at least 6 characters.",
  };
  return map[error.code] ?? error.message ?? "Authentication failed.";
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const [mode, setMode] = useState("login");       // "login" | "signup"
  const [role, setRole] = useState("student");     // "student" | "rider"
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [matric, setMatric] = useState("");
  const [plate, setPlate] = useState("");
  const [vehicleType, setVehicleType] = useState("keke");

  async function handleLogin() {
    if (!email || !password) return setError("Enter email and password.");
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    const nameRegex = /^[a-zA-Z\s.']{3,60}$/;
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    const matricRegex = /^[A-Z0-9/-]{5,30}$/i;
    const plateRegex = /^[A-Z0-9\s-]{4,15}$/i;

    if (!nameRegex.test(name)) return setError("Enter a valid full name (3–60 letters).");
    if (!phoneRegex.test(phone)) return setError("Enter a valid phone number.");

    setLoading(true);
    setError("");

    try {
      if (role === "student") {
        if (!matricRegex.test(matric)) {
          setLoading(false);
          return setError("Enter a valid Matric Number.");
        }
        const valid = await verifyMatricNumber(name, matric);
        if (!valid) {
          setLoading(false);
          return setError("Name or Matric Number does not match our records.");
        }
      } else {
        if (!plateRegex.test(plate)) {
          setLoading(false);
          return setError("Enter a valid Plate Number.");
        }
        const valid = await verifyRiderDetails(name, phone, plate);
        if (!valid) {
          setLoading(false);
          return setError("Rider details do not match our authorized records.");
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
        userData.matricNo = matric.toUpperCase();
        userData.wallet = { balance: 0, currency: "NGN", lastTopUp: null, lastDeduction: null };
        userData.debt = { amount: 0, rideId: null, incurredAt: null };
      } else {
        userData.plateNo = plate.toUpperCase();
        userData.vehicleType = vehicleType;
        userData.earnings = { balance: 0, totalEarned: 0, lastPayout: null };
      }

      await setDoc(doc(db, "users", cred.user.uid), userData);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Brand */}
        <View style={styles.brand}>
          <Text style={styles.brandText}>
            <Text style={styles.brandOp}>OP</Text>
            <Text style={styles.brandRides}>rides</Text>
          </Text>
          <Text style={styles.tagline}>Let's move smarter.</Text>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, mode === "login" && styles.tabActive]}
            onPress={() => { setMode("login"); setError(""); }}
          >
            <Text style={[styles.tabText, mode === "login" && styles.tabTextActive]}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, mode === "signup" && styles.tabActive]}
            onPress={() => { setMode("signup"); setError(""); }}
          >
            <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {/* Role toggle — signup only */}
        {mode === "signup" && (
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleBtn, role === "student" && styles.roleBtnActive]}
              onPress={() => setRole("student")}
            >
              <Text style={[styles.roleBtnText, role === "student" && styles.roleBtnTextActive]}>Student</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleBtn, role === "rider" && styles.roleBtnActive]}
              onPress={() => setRole("rider")}
            >
              <Text style={[styles.roleBtnText, role === "rider" && styles.roleBtnTextActive]}>Rider</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Fields */}
        <View style={styles.form}>
          {mode === "signup" && (
            <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#666"
              value={name} onChangeText={setName} autoCapitalize="words" />
          )}

          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666"
            value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

          <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#666"
            value={password} onChangeText={setPassword} secureTextEntry />

          {mode === "signup" && (
            <TextInput style={styles.input} placeholder="Phone Number" placeholderTextColor="#666"
              value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          )}

          {mode === "signup" && role === "student" && (
            <TextInput style={styles.input} placeholder="Matric Number" placeholderTextColor="#666"
              value={matric} onChangeText={setMatric} autoCapitalize="characters" />
          )}

          {mode === "signup" && role === "rider" && (
            <>
              <TextInput style={styles.input} placeholder="Plate Number" placeholderTextColor="#666"
                value={plate} onChangeText={setPlate} autoCapitalize="characters" />
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

        {/* Error */}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
          onPress={mode === "login" ? handleLogin : handleSignup}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#0F0F13" />
            : <Text style={styles.submitBtnText}>{mode === "login" ? "Login" : "Sign Up"}</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F0F13" },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 80 },

  brand: { alignItems: "center", marginBottom: 40 },
  brandText: { fontSize: 42, fontWeight: "800", letterSpacing: -1 },
  brandOp: { color: "#FFFFFF" },
  brandRides: { color: "#00C48C" },
  tagline: { color: "#666", marginTop: 6, fontSize: 15 },

  tabs: { flexDirection: "row", backgroundColor: "#1A1A22", borderRadius: 12, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 9 },
  tabActive: { backgroundColor: "#00C48C" },
  tabText: { color: "#666", fontWeight: "600" },
  tabTextActive: { color: "#0F0F13" },

  roleRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  roleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#2a2a35" },
  roleBtnActive: { borderColor: "#00C48C", backgroundColor: "rgba(0,196,140,0.08)" },
  roleBtnText: { color: "#666", fontWeight: "600" },
  roleBtnTextActive: { color: "#00C48C" },

  form: { gap: 12, marginBottom: 8 },
  input: {
    backgroundColor: "#1A1A22",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#FFFFFF",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2a2a35",
  },

  vehicleRow: { flexDirection: "row", gap: 10 },
  vehicleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#2a2a35" },
  vehicleBtnActive: { borderColor: "#00C48C", backgroundColor: "rgba(0,196,140,0.08)" },
  vehicleBtnText: { color: "#666", fontWeight: "600" },
  vehicleBtnTextActive: { color: "#00C48C" },

  error: { color: "#fca5a5", textAlign: "center", marginVertical: 8, fontSize: 13 },

  submitBtn: { backgroundColor: "#00C48C", borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 12 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#0F0F13", fontWeight: "700", fontSize: 16 },
});
