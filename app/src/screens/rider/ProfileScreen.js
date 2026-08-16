/**
 * RiderProfileScreen.js
 *
 * Rider profile management with vehicle info, ratings, and settings.
 * Adapted from student ProfileScreen but with rider-specific functionality.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header                      │
 *  │  Avatar (initials + gradient)│
 *  │  Name / plate / email        │
 *  │  Stats card                  │
 *  │   ├─ Total rides             │
 *  │   ├─ Total earned            │
 *  │   ├─ Average rating          │
 *  │   └─ This week               │
 *  │  Vehicle info card           │
 *  │   ├─ Plate number            │
 *  │   ├─ Vehicle type            │
 *  │   └─ Status                  │
 *  │  Account info card           │
 *  │   ├─ Phone                   │
 *  │   ├─ Email (read-only)       │
 *  │   └─ Biometric toggle        │
 *  │  Log Out button              │
 *  └──────────────────────────────┘
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import useStore from "../../store";
import { fetchRiderStats, formatNaira } from "../../services/rider";
import { auth, signOut } from "../../config/firebase";
import {
  isBiometricsAvailable,
  isBiometricsEnabled,
  getBiometricLabel,
  registerBiometrics,
  clearBiometrics,
} from "../../services/biometrics";
import SupportModal from "../shared/SupportModal";

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  orange:    "#FF5E1A",
  orangeMute: "rgba(255,94,26,0.12)",
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
      .join("") || "RD"
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
  const { bg1, bg2 } = getGradientHues(name);

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 }
      ]}
    >
      <View
        style={[
          styles.avatarGradient,
          { 
            width: size, 
            height: size, 
            borderRadius: size / 2,
            backgroundColor: bg1, // Fallback for gradient
          }
        ]}
      >
        <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>
          {initials}
        </Text>
      </View>
    </View>
  );
}

function StatsCard({ stats, loading }) {
  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={C.orange} />
      </View>
    );
  }

  const avgRating = 4.8; // Placeholder - would come from ratings system

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Statistics</Text>
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.totalRides}</Text>
          <Text style={styles.statCaption}>Total Rides</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{formatNaira(stats.totalEarned)}</Text>
          <Text style={styles.statCaption}>Total Earned</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{avgRating.toFixed(1)} ⭐</Text>
          <Text style={styles.statCaption}>Rating</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{formatNaira(stats.todayEarnings)}</Text>
          <Text style={styles.statCaption}>Today</Text>
        </View>
      </View>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "—"}</Text>
    </View>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function RiderProfileScreen() {
  const { currentUser, showToast, isRiderOnline } = useStore();

  const [stats,        setStats]       = useState({ totalRides: 0, totalEarned: 0, todayEarnings: 0 });
  const [loadingStats, setLoadingStats] = useState(true);
  const [showSupport,  setShowSupport]  = useState(false);
  
  // Biometric state
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled,   setBioEnabled]   = useState(false);
  const [bioLabel,     setBioLabel]     = useState("Biometrics");
  const [bioLoading,   setBioLoading]   = useState(false);

  const name       = currentUser?.name      || currentUser?.displayName || "Rider";
  const email      = currentUser?.email     || "—";
  const plateNo    = currentUser?.plateNo   || null;
  const phone      = currentUser?.phone     || currentUser?.phoneNumber || null;
  const vehicleType = currentUser?.vehicleType || "keke";

  useEffect(() => {
    if (!currentUser?.uid) return;
    fetchRiderStats(currentUser.uid)
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
            await signOut(auth);
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* ── Header ──────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Profile</Text>
          <View style={[styles.statusBadge, isRiderOnline ? styles.onlineBadge : styles.offlineBadge]}>
            <Text style={[styles.statusText, isRiderOnline ? styles.onlineText : styles.offlineText]}>
              {isRiderOnline ? "ONLINE" : "OFFLINE"}
            </Text>
          </View>
        </View>

        {/* ── Profile Info ────────────────────────────────────── */}
        <View style={styles.profileSection}>
          <Avatar name={name} />
          <View style={styles.profileText}>
            <Text style={styles.profileName}>{name}</Text>
            <Text style={styles.profilePlate}>Plate: {plateNo || "—"}</Text>
            <Text style={styles.profileEmail}>{email}</Text>
          </View>
        </View>

        {/* ── Statistics Card ─────────────────────────────────── */}
        <StatsCard stats={stats} loading={loadingStats} />

        {/* ── Vehicle Info Card ───────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Vehicle</Text>
          <InfoRow label="Plate Number" value={plateNo} />
          <InfoRow label="Vehicle Type" value={vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1)} />
          <InfoRow label="Status" value={isRiderOnline ? "Online" : "Offline"} />
        </View>

        {/* ── Account Info Card ───────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <InfoRow label="Full Name"  value={name} />
          <InfoRow label="Email"      value={email} />
          <InfoRow label="Phone"      value={phone} />
          
          {bioAvailable && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{bioLabel}</Text>
              <View style={styles.biometricRow}>
                {bioLoading ? (
                  <ActivityIndicator size="small" color={C.orange} />
                ) : (
                  <Switch
                    value={bioEnabled}
                    onValueChange={handleBiometricToggle}
                    trackColor={{ false: "#2a2a35", true: C.orangeMute }}
                    thumbColor={bioEnabled ? C.orange : "#888"}
                  />
                )}
              </View>
            </View>
          )}
        </View>

        {/* ── Log Out Button ──────────────────────────────────── */}
        <TouchableOpacity style={styles.helpBtn} onPress={() => setShowSupport(true)} activeOpacity={0.8}>
          <Text style={styles.helpText}>Help & Support</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.appVersion}>OpRides v2.0 — Rider Edition</Text>
      </ScrollView>

      <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 48 },

  header: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    marginBottom:   32,
  },
  greeting: { color: C.text, fontSize: 28, fontWeight: "700" },

  statusBadge:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  onlineBadge:    { backgroundColor: C.orangeMute },
  offlineBadge:   { backgroundColor: "#2a2a35" },
  statusText:     { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  onlineText:     { color: C.orange },
  offlineText:    { color: C.sub },

  profileSection: {
    flexDirection: "row",
    alignItems:    "center",
    marginBottom:  24,
    padding:       20,
    backgroundColor: C.surface,
    borderRadius:  16,
    borderWidth:   1,
    borderColor:   C.border,
  },
  avatar: { marginRight: 16 },
  avatarGradient: {
    alignItems:     "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontWeight: "700" },
  profileText: { flex: 1 },
  profileName:  { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 4 },
  profilePlate: { color: C.orange, fontSize: 14, fontWeight: "600", marginBottom: 2 },
  profileEmail: { color: C.sub, fontSize: 14 },

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
    flexDirection: "row",
    flexWrap:      "wrap",
    gap:           12,
  },
  statItem: {
    flex:            1,
    minWidth:        "45%",
    alignItems:      "center",
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
  },
  statValue: { color: C.text, fontWeight: "800", fontSize: 18, marginBottom: 4 },
  statCaption: { color: C.sub, fontSize: 11 },

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
    borderColor:     C.border,
    marginTop:       8,
    marginBottom:    24,
  },
  logoutText: { color: "#fca5a5", fontWeight: "600" },

  helpBtn: {
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      "center",
    borderWidth:     1,
    borderColor:     C.border,
    marginBottom:    12,
  },
  helpText: { color: C.text, fontWeight: "600" },

  appVersion: {
    textAlign: "center",
    color:     C.sub,
    fontSize:  12,
    marginTop: 8,
  },
});