/**
 * ProfileScreen.js
 *
 * Student profile — mirrors the profileView / sidebar from the main branch,
 * redesigned for React Native.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header                      │
 *  │  Avatar (initials + gradient)│
 *  │  Name / matric / email       │
 *  │  Stats card                  │
 *  │   ├─ Total rides             │
 *  │   ├─ Total spent             │
 *  │   ├─ Favourite pickup        │
 *  │   └─ Favourite drop-off      │
 *  │  Account info card           │
 *  │   ├─ Phone                   │
 *  │   └─ Email (read-only)       │
 *  │  Admin panel link (if admin) │
 *  │  Log Out button              │
 *  └──────────────────────────────┘
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import useStore from "../../store";
import { fetchProfileStats, formatNaira } from "../../services/wallet";
import { auth, signOut } from "../../config/firebase";
import SupportModal from "../shared/SupportModal";
import {
  isBiometricsAvailable,
  isBiometricsEnabled,
  getBiometricLabel,
  registerBiometrics,
  clearBiometrics,
} from "../../services/biometrics";

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  text:      "#FFFFFF",
  sub:       "#888",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getInitials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join("") || "ST"
  );
}

function getGradientHues(name = "") {
  const src = String(name || "OpRides");
  let hash  = 0;
  for (let i = 0; i < src.length; i++) {
    hash = src.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue  = Math.abs(hash) % 360;
  const hue2 = (hue + 52) % 360;
  return { bg1: `hsl(${hue}, 72%, 38%)`, bg2: `hsl(${hue2}, 78%, 48%)` };
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function Avatar({ name, size = 88 }) {
  const initials = getInitials(name);
  const { bg1 }  = getGradientHues(name);
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg1 },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value || "Not provided"}</Text>
    </View>
  );
}

function StatItem({ value, caption, accent }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, accent && { color: C.green }]}>
        {value ?? "—"}
      </Text>
      <Text style={styles.statCaption}>{caption}</Text>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { currentUser, showToast } = useStore();

  const [stats,        setStats]       = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  
  // Support modal
  const [showSupport, setShowSupport] = useState(false);

  // Biometric state
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLabel,     setBioLabel]     = useState("Biometrics");
  const [bioLoading,   setBioLoading]   = useState(false);

  const name     = currentUser?.name      || currentUser?.displayName || "Student";
  const email    = currentUser?.email     || "—";
  const matric   = currentUser?.matricNo  || null;
  const phone    = currentUser?.phone     || currentUser?.phoneNumber || null;
  const isAdmin  = !!currentUser?.isAdmin;

  useEffect(() => {
    if (!currentUser?.uid) return;
    fetchProfileStats(currentUser.uid)
      .then((s) => setStats(s))
      .finally(() => setLoadingStats(false));
  }, [currentUser?.uid]);

  // Check biometric status
  useEffect(() => {
    (async () => {
      const available = await isBiometricsAvailable();
      const enabled   = await isBiometricsEnabled();
      const label     = await getBiometricLabel();
      setBioAvailable(available);
      setBioEnabled(enabled);
      setBioLabel(label);
    })();
  }, []);

  async function handleBiometricToggle() {
    if (!currentUser?.email) return;
    
    setBioLoading(true);
    try {
      if (bioEnabled) {
        await clearBiometrics();
        setBioEnabled(false);
        showToast("Biometric login disabled", "success");
      } else {
        Alert.alert(
          `Enable ${bioLabel}?`,
          "You'll need to enter your current password to set up biometric login.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Continue",
              onPress: () => {
                Alert.prompt(
                  "Enter Password",
                  "Enter your current password to enable biometric login:",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Enable",
                      onPress: async (password) => {
                        if (!password) return;
                        try {
                          await registerBiometrics(currentUser.email, password);
                          setBioEnabled(true);
                          showToast("Biometric login enabled", "success");
                        } catch (e) {
                          showToast(e.message || "Failed to enable biometrics", "error");
                        }
                      },
                    },
                  ],
                  "secure-text"
                );
              },
            },
          ]
        );
      }
    } catch (e) {
      showToast(e.message || "Biometric setup failed", "error");
    } finally {
      setBioLoading(false);
    }
  }

  function handleLogout() {
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log Out",
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(auth);
              useStore.getState().clearCurrentUser();
            } catch (err) {
              showToast("Failed to log out.", "error");
              console.error("[Profile] signOut error:", err);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkOp}>OP</Text>
          <Text style={styles.wordmarkRides}>rides</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <Avatar name={name} size={88} />
          <Text style={styles.profileName}>{name}</Text>
          {matric && <Text style={styles.profileMatric}>{matric}</Text>}
          <Text style={styles.profileEmail}>{email}</Text>
          {isAdmin && (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>Admin</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ride Stats</Text>

          {loadingStats ? (
            <ActivityIndicator color={C.green} style={{ marginVertical: 20 }} />
          ) : (
            <>
              <View style={styles.statsGrid}>
                <StatItem value={String(stats?.totalRides ?? 0)} caption="Total Rides" accent />
                <StatItem value={formatNaira(stats?.totalSpent ?? 0)} caption="Total Spent" />
              </View>

              <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, marginTop: 4 }]}>
                <Text style={styles.infoLabel}>Fav. Pickup</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{stats?.topPickup ?? "No rides yet"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Fav. Drop-off</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{stats?.topDropoff ?? "No rides yet"}</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <InfoRow label="Full Name"  value={name} />
          <InfoRow label="Email"      value={email} />
          <InfoRow label="Phone"      value={phone} />
          <InfoRow label="Matric No." value={matric} />
          
          {bioAvailable && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{bioLabel}</Text>
              <View style={styles.biometricRow}>
                {bioLoading ? (
                  <ActivityIndicator size="small" color={C.green} />
                ) : (
                  <Switch
                    value={bioEnabled}
                    onValueChange={handleBiometricToggle}
                    trackColor={{ false: "#2a2a35", true: C.greenMute }}
                    thumbColor={bioEnabled ? C.green : "#888"}
                  />
                )}
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.helpBtn}
          onPress={() => setShowSupport(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.helpIcon}>🛟</Text>
          <Text style={styles.helpText}>Help & Support</Text>
          <Text style={styles.helpChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.appVersion}>OpRides v2.0 — Expo Edition</Text>
      </ScrollView>

      <SupportModal
        visible={showSupport}
        onClose={() => setShowSupport(false)}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48 },

  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 20,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     16,
    backgroundColor:   C.bg,
  },
  headerTitle:   { color: C.text, fontWeight: "800", fontSize: 24 },
  wordmark:      { flexDirection: "row" },
  wordmarkOp:    { color: C.text, fontWeight: "800", fontSize: 20 },
  wordmarkRides: { color: C.green, fontWeight: "800", fontSize: 20 },

  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatar:        { alignItems: "center", justifyContent: "center", marginBottom: 14 },
  avatarText:    { color: "#fff", fontWeight: "800" },
  profileName:   { color: C.text, fontWeight: "800", fontSize: 22, textAlign: "center" },
  profileMatric: { color: C.sub, fontSize: 13, marginTop: 4, textAlign: "center" },
  profileEmail:  { color: C.sub, fontSize: 13, marginTop: 2, textAlign: "center" },
  adminBadge:    { marginTop: 10, backgroundColor: C.greenMute, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: C.green },
  adminBadgeText:{ color: C.green, fontSize: 12, fontWeight: "700" },

  card: {
    backgroundColor: C.surface,
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     C.border,
    padding:         16,
    marginBottom:    16,
  },
  cardTitle: { color: C.text, fontWeight: "700", fontSize: 15, marginBottom: 12 },

  statsGrid: {
    flexDirection:  "row",
    gap:            12,
    marginBottom:   8,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  statValue: { color: C.text, fontWeight: "800", fontSize: 20, marginBottom: 4 },
  statCaption: { color: C.sub, fontSize: 12 },

  infoRow: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  infoLabel: { color: C.sub, fontSize: 13, flex: 1 },
  infoValue: { color: C.text, fontSize: 13, fontWeight: "600", flex: 2, textAlign: "right" },

  biometricRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 2,
    justifyContent: "flex-end",
  },

  logoutBtn: {
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      "center",
    borderWidth:     1,
    borderColor:     "#ef4444",
    backgroundColor: "rgba(239,68,68,0.12)",
    marginBottom:    12,
    marginTop:       4,
  },
  logoutText: { color: "#fca5a5", fontWeight: "700", fontSize: 15 },

  appVersion: { color: C.sub, fontSize: 11, textAlign: "center", marginBottom: 8 },


  helpBtn: {
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      "center",
    borderWidth:     1,
    borderColor:     "#2a2a35",
    marginBottom:    12,
  },
  helpText: { color: "#FFFFFF", fontWeight: "600" },
});