import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { signOut, auth } from "../../config/firebase";
import useStore from "../../store";

/**
 * Rider HomeScreen — placeholder.
 * This will become the rider dashboard with available ride requests,
 * live map, and session controls.
 *
 * Next steps for this screen:
 *  - Go-online / go-offline toggle
 *  - Incoming ride request cards
 *  - Campus map with student pickup markers
 *  - Active ride tracking + completion
 */
export default function RiderHomeScreen() {
  const { currentUser, clearCurrentUser } = useStore();

  async function handleLogout() {
    await signOut(auth);
    clearCurrentUser();
  }

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        <Text style={styles.logo}>
          <Text style={styles.logoOp}>OP</Text>
          <Text style={styles.logoRides}>rides</Text>
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>RIDER</Text>
        </View>
        <Text style={styles.greeting}>
          Welcome, {currentUser?.name ?? currentUser?.displayName ?? "Rider"}
        </Text>
        <Text style={styles.sub}>Rider dashboard — map and requests coming next.</Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0F0F13", padding: 24, paddingTop: 60 },
  content: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { fontSize: 36, fontWeight: "800", marginBottom: 16 },
  logoOp: { color: "#FFFFFF" },
  logoRides: { color: "#00C48C" },
  badge: { backgroundColor: "#FF5E1A", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginBottom: 20 },
  badgeText: { color: "#FFFFFF", fontWeight: "700", fontSize: 11, letterSpacing: 1.5 },
  greeting: { color: "#FFFFFF", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  sub: { color: "#555", fontSize: 14 },
  logoutBtn: { paddingVertical: 14, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#2a2a35" },
  logoutText: { color: "#fca5a5", fontWeight: "600" },
});
