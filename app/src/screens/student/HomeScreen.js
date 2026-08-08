import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { signOut } from "../../config/firebase";
import { auth } from "../../config/firebase";
import useStore from "../../store";

/**
 * Student HomeScreen — placeholder.
 * This will become the main map + ride request screen.
 * 
 * Next steps for this screen:
 *  - Mount the campus map (react-native-maps, mapType="none")
 *  - Draw campus buildings and paths from Firestore
 *  - Ride request bottom sheet
 *  - Live rider tracking
 */
export default function StudentHomeScreen() {
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
        <Text style={styles.greeting}>
          Welcome, {currentUser?.name ?? currentUser?.displayName ?? "Student"}
        </Text>
        <Text style={styles.sub}>Student dashboard — map coming next.</Text>
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
  logo: { fontSize: 36, fontWeight: "800", marginBottom: 24 },
  logoOp: { color: "#FFFFFF" },
  logoRides: { color: "#00C48C" },
  greeting: { color: "#FFFFFF", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  sub: { color: "#555", fontSize: 14 },
  logoutBtn: { paddingVertical: 14, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#2a2a35" },
  logoutText: { color: "#fca5a5", fontWeight: "600" },
});
