/**
 * RiderHomeScreen.js
 *
 * Main rider dashboard with online/offline toggle, ride requests, active passengers, and earnings.
 * Mirrors the rider dashboard functionality from the main branch.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header (greeting + status)  │
 *  │  Online Toggle Switch        │
 *  │  Earnings Summary Card       │
 *  │  Incoming Requests List      │ 
 *  │  Active Passengers List      │
 *  │  Next Stop Controls          │
 *  │  Map View (pickup/dropoff)   │
 *  └──────────────────────────────┘
 */

import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";

import useStore from "../../store";
import { signOut, auth } from "../../config/firebase";
import {
  setRiderStatus,
  getRiderStatus,
  listenToRideRequests,
  listenToActiveRides,
  listenToRiderEarnings,
  acceptRideRequest,
  declineRideRequest,
  completePickup,
  completeDropoff,
  fetchRiderStats,
  formatNaira,
  getNextRideAction,
} from "../../services/rider";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35", 
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  orange:    "#FF5E1A",
  orangeMute: "rgba(255,94,26,0.12)",
  text:      "#FFFFFF",
  sub:       "#888",
  error:     "#fca5a5",
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function StatusBadge({ isOnline }) {
  return (
    <View style={[styles.statusBadge, isOnline ? styles.statusOnline : styles.statusOffline]}>
      <Text style={[styles.statusText, isOnline ? styles.statusTextOnline : styles.statusTextOffline]}>
        {isOnline ? "ONLINE" : "OFFLINE"}
      </Text>
    </View>
  );
}

function EarningsCard({ stats, loading }) {
  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={C.green} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Earnings</Text>
      <View style={styles.earningsGrid}>
        <View style={styles.earningItem}>
          <Text style={styles.earningValue}>{formatNaira(stats.todayEarnings)}</Text>
          <Text style={styles.earningLabel}>Today</Text>
        </View>
        <View style={styles.earningItem}>
          <Text style={styles.earningValue}>{formatNaira(stats.balance)}</Text>
          <Text style={styles.earningLabel}>Balance</Text>
        </View>
        <View style={styles.earningItem}>
          <Text style={styles.earningValue}>{stats.totalRides}</Text>
          <Text style={styles.earningLabel}>Total Rides</Text>
        </View>
      </View>
    </View>
  );
}

function RideRequestCard({ request, onAccept, onDecline, accepting }) {
  return (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <Text style={styles.requestStudent}>{request.studentName}</Text>
        <Text style={styles.requestFare}>₦150</Text>
      </View>
      <View style={styles.requestRoute}>
        <Text style={styles.routeLabel}>From:</Text>
        <Text style={styles.routeLocation}>{request.pickup?.name || "Unknown"}</Text>
      </View>
      <View style={styles.requestRoute}>
        <Text style={styles.routeLabel}>To:</Text>
        <Text style={styles.routeLocation}>{request.dropoff?.name || "Unknown"}</Text>
      </View>
      
      <View style={styles.requestActions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.declineBtn]}
          onPress={() => onDecline(request.id)}
          disabled={accepting}
        >
          <Text style={styles.declineBtnText}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.acceptBtn]}
          onPress={() => onAccept(request.id)}
          disabled={accepting}
        >
          {accepting ? (
            <ActivityIndicator color="#0F0F13" size="small" />
          ) : (
            <Text style={styles.acceptBtnText}>Accept</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ActiveRideCard({ ride, onPickup, onDropoff, actionLoading }) {
  const nextAction = getNextRideAction(ride);
  
  return (
    <View style={styles.activeCard}>
      <View style={styles.activeHeader}>
        <Text style={styles.activeStudent}>{ride.studentName}</Text>
        <View style={[styles.statusDot, ride.status === "onTrip" ? styles.statusDotActive : styles.statusDotPending]} />
      </View>
      
      <View style={styles.activeRoute}>
        <Text style={styles.routeLabel}>From:</Text>
        <Text style={styles.routeLocation}>{ride.pickup?.name || "Unknown"}</Text>
      </View>
      <View style={styles.activeRoute}>
        <Text style={styles.routeLabel}>To:</Text>
        <Text style={styles.routeLocation}>{ride.dropoff?.name || "Unknown"}</Text>
      </View>
      
      <Text style={styles.rideStatus}>
        Status: {ride.pickupStatus === "completed" ? "On board" : "Waiting for pickup"}
      </Text>
      
      {nextAction && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.nextActionBtn]}
          onPress={() => {
            if (nextAction.type === "pickup") {
              onPickup(ride.id);
            } else {
              onDropoff(ride.id);
            }
          }}
          disabled={actionLoading}
        >
          {actionLoading ? (
            <ActivityIndicator color="#0F0F13" size="small" />
          ) : (
            <Text style={styles.nextActionText}>{nextAction.label}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function RiderHomeScreen() {
  const { currentUser, showToast } = useStore();

  // State
  const [isOnline, setIsOnline] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  
  const [rideRequests, setRideRequests] = useState([]);
  const [activeRides, setActiveRides] = useState([]);
  const [earnings, setEarnings] = useState({ balance: 0, totalEarned: 0 });
  
  const [stats, setStats] = useState({ todayEarnings: 0, totalRides: 0, balance: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  
  const [accepting, setAccepting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Refs for cleanup
  const requestsUnsubscribe = useRef(null);
  const ridesUnsubscribe = useRef(null);
  const earningsUnsubscribe = useRef(null);

  const riderId = currentUser?.uid;

  // ── Initialize data and listeners ─────────────────────────────────────────
  useEffect(() => {
    if (!riderId) return;

    // Load initial rider status
    getRiderStatus(riderId).then((status) => {
      setIsOnline(status.isOnline);
    });

    // Fetch initial stats
    fetchRiderStats(riderId)
      .then(setStats)
      .finally(() => setStatsLoading(false));

    // Set up listeners
    if (isOnline) {
      requestsUnsubscribe.current = listenToRideRequests(riderId, setRideRequests);
    }
    
    ridesUnsubscribe.current = listenToActiveRides(riderId, setActiveRides);
    earningsUnsubscribe.current = listenToRiderEarnings(riderId, setEarnings);

    // Cleanup
    return () => {
      requestsUnsubscribe.current?.();
      ridesUnsubscribe.current?.();
      earningsUnsubscribe.current?.();
    };
  }, [riderId, isOnline]);

  // ── Status toggle ─────────────────────────────────────────────────────────
  async function handleStatusToggle() {
    if (!riderId) return;
    
    setStatusLoading(true);
    try {
      const newStatus = !isOnline;
      const result = await setRiderStatus(riderId, newStatus);
      
      if (result.success) {
        setIsOnline(newStatus);
        showToast(newStatus ? "You're now online" : "You're now offline", "success");
        
        // Set up or cleanup request listener
        if (newStatus) {
          requestsUnsubscribe.current = listenToRideRequests(riderId, setRideRequests);
        } else {
          requestsUnsubscribe.current?.();
          setRideRequests([]);
        }
      } else {
        showToast(result.error || "Failed to update status", "error");
      }
    } catch (error) {
      showToast("Status update failed", "error");
    } finally {
      setStatusLoading(false);
    }
  }

  // ── Ride request handlers ─────────────────────────────────────────────────
  async function handleAcceptRequest(requestId) {
    setAccepting(true);
    try {
      const result = await acceptRideRequest(requestId, riderId);
      if (result.success) {
        showToast("Ride accepted!", "success");
      } else {
        showToast(result.error || "Failed to accept ride", "error");
      }
    } catch (error) {
      showToast("Accept failed", "error");
    } finally {
      setAccepting(false);
    }
  }

  async function handleDeclineRequest(requestId) {
    const result = await declineRideRequest(requestId);
    if (result.success) {
      showToast("Request declined", "info");
    }
  }

  // ── Active ride handlers ──────────────────────────────────────────────────
  async function handlePickupComplete(rideId) {
    setActionLoading(true);
    try {
      const result = await completePickup(rideId);
      if (result.success) {
        showToast("Pickup completed", "success");
      } else {
        showToast(result.error || "Pickup failed", "error");
      }
    } catch (error) {
      showToast("Pickup action failed", "error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDropoffComplete(rideId) {
    setActionLoading(true);
    try {
      const result = await completeDropoff(rideId);
      if (result.success) {
        showToast(`Ride completed! Earned ${formatNaira(result.earned)}`, "success");
        // Refresh stats
        const newStats = await fetchRiderStats(riderId);
        setStats(newStats);
      } else {
        showToast(result.error || "Dropoff failed", "error");
      }
    } catch (error) {
      showToast("Dropoff action failed", "error");
    } finally {
      setActionLoading(false);
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function handleLogout() {
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

  // ── Render ────────────────────────────────────────────────────────────────

  const name = currentUser?.name || currentUser?.displayName || "Rider";
  const plateNo = currentUser?.plateNo || "N/A";

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        
        {/* ── Header ──────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, {name}</Text>
            <Text style={styles.plateText}>Plate: {plateNo}</Text>
          </View>
          <StatusBadge isOnline={isOnline} />
        </View>

        {/* ── Online Toggle ───────────────────────────────────── */}
        <View style={styles.toggleCard}>
          <View>
            <Text style={styles.toggleTitle}>Go Online</Text>
            <Text style={styles.toggleSub}>Accept ride requests</Text>
          </View>
          {statusLoading ? (
            <ActivityIndicator color={C.green} />
          ) : (
            <Switch
              value={isOnline}
              onValueChange={handleStatusToggle}
              trackColor={{ false: C.border, true: C.greenMute }}
              thumbColor={isOnline ? C.green : C.sub}
            />
          )}
        </View>

        {/* ── Earnings Summary ────────────────────────────────── */}
        <EarningsCard stats={stats} loading={statsLoading} />

        {/* ── Ride Requests ───────────────────────────────────── */}
        {isOnline && rideRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Incoming Requests</Text>
            {rideRequests.map((request) => (
              <RideRequestCard
                key={request.id}
                request={request}
                onAccept={handleAcceptRequest}
                onDecline={handleDeclineRequest}
                accepting={accepting}
              />
            ))}
          </View>
        )}

        {/* ── Active Passengers ───────────────────────────────── */}
        {activeRides.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Passengers</Text>
            {activeRides.map((ride) => (
              <ActiveRideCard
                key={ride.id}
                ride={ride}
                onPickup={handlePickupComplete}
                onDropoff={handleDropoffComplete}
                actionLoading={actionLoading}
              />
            ))}
          </View>
        )}

        {/* ── Empty States ────────────────────────────────────── */}
        {!isOnline && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>You're Offline</Text>
            <Text style={styles.emptySub}>Turn on online status to receive ride requests</Text>
          </View>
        )}

        {isOnline && rideRequests.length === 0 && activeRides.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No Active Requests</Text>
            <Text style={styles.emptySub}>Stay online to receive ride requests from students</Text>
          </View>
        )}

      </ScrollView>

      {/* ── Logout Button ──────────────────────────────────────── */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1, paddingHorizontal: 20, paddingTop: 60 },

  header: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   20,
  },
  greeting:   { color: C.text, fontSize: 24, fontWeight: "700" },
  plateText:  { color: C.sub, fontSize: 14, marginTop: 2 },

  statusBadge:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusOnline:       { backgroundColor: C.greenMute },
  statusOffline:      { backgroundColor: C.orangeMute },
  statusText:         { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  statusTextOnline:   { color: C.green },
  statusTextOffline:  { color: C.orange },

  toggleCard: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    backgroundColor: C.surface,
    borderRadius:   16,
    padding:        16,
    marginBottom:   16,
    borderWidth:    1,
    borderColor:    C.border,
  },
  toggleTitle: { color: C.text, fontSize: 16, fontWeight: "600" },
  toggleSub:   { color: C.sub, fontSize: 13, marginTop: 2 },

  card: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         16,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 12 },

  earningsGrid: { flexDirection: "row", gap: 12 },
  earningItem: {
    flex:           1,
    alignItems:     "center",
    paddingVertical: 12,
    backgroundColor: C.bg,
    borderRadius:   12,
    borderWidth:    1,
    borderColor:    C.border,
  },
  earningValue:   { color: C.green, fontSize: 18, fontWeight: "800", marginBottom: 4 },
  earningLabel:   { color: C.sub, fontSize: 11 },

  section:      { marginBottom: 16 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 12 },

  requestCard: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         16,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     C.border,
  },
  requestHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   8,
  },
  requestStudent: { color: C.text, fontSize: 16, fontWeight: "600" },
  requestFare:    { color: C.green, fontSize: 16, fontWeight: "700" },

  requestRoute:   { flexDirection: "row", marginBottom: 4 },
  routeLabel:     { color: C.sub, fontSize: 13, width: 40 },
  routeLocation:  { color: C.text, fontSize: 13, flex: 1 },

  requestActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  actionBtn: {
    flex:            1,
    paddingVertical: 12,
    borderRadius:    12,
    alignItems:      "center",
  },
  declineBtn:     { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  declineBtnText: { color: C.sub, fontWeight: "600" },
  acceptBtn:      { backgroundColor: C.green },
  acceptBtnText:  { color: "#0F0F13", fontWeight: "700" },

  activeCard: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         16,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     C.green,
  },
  activeHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   8,
  },
  activeStudent: { color: C.text, fontSize: 16, fontWeight: "600" },
  
  statusDot:        { width: 8, height: 8, borderRadius: 4 },
  statusDotActive:  { backgroundColor: C.green },
  statusDotPending: { backgroundColor: C.orange },

  activeRoute:   { flexDirection: "row", marginBottom: 4 },
  rideStatus:    { color: C.sub, fontSize: 13, marginTop: 8, marginBottom: 12 },

  nextActionBtn:  { backgroundColor: C.green, marginTop: 8 },
  nextActionText: { color: "#0F0F13", fontWeight: "700" },

  emptyState: {
    alignItems:     "center",
    paddingVertical: 40,
  },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySub:   { color: C.sub, fontSize: 14, textAlign: "center" },

  logoutBtn: {
    margin:          20,
    paddingVertical: 14,
    alignItems:      "center",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
  },
  logoutText: { color: C.error, fontWeight: "600" },
});