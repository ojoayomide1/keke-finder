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
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";

import useStore from "../../store";
import { sendLocalNotification } from "../../services/notifications";
import {
  setRiderStatus,
  getRiderStatus,
  listenToRideRequests,
  listenToActiveRides,
  listenToRiderEarnings,
  acceptRideRequest,
  declineRideRequest,
  completeNextStop,
  fetchRiderStats,
  formatNaira,
  getNextRideAction,
} from "../../services/rider";
import { db, doc, setDoc, serverTimestamp } from "../../config/firebase";

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

function ActiveRideCard({ ride, onNextStop, actionLoading }) {
  const nextAction = getNextRideAction(ride);
  
  // Show all passengers in this ride
  const passengers = ride.passengers ? Object.values(ride.passengers) : [];
  
  return (
    <View style={styles.activeCard}>
      <View style={styles.activeHeader}>
        <Text style={styles.activeStudent}>
          {passengers.length > 1 
            ? `${passengers.length} passengers` 
            : passengers[0]?.studentName || "Passenger"
          }
        </Text>
        <View style={[styles.statusDot, ride.status === "onTrip" ? styles.statusDotActive : styles.statusDotPending]} />
      </View>
      
      {/* Show all passenger routes */}
      {passengers.map((passenger, index) => (
        <View key={passenger.studentId} style={index > 0 ? { marginTop: 8 } : {}}>
          {index > 0 && <View style={styles.passengerDivider} />}
          <Text style={styles.passengerName}>{passenger.studentName}</Text>
          <View style={styles.activeRoute}>
            <Text style={styles.routeLabel}>From:</Text>
            <Text style={styles.routeLocation}>{passenger.pickup?.name || "Unknown"}</Text>
          </View>
          <View style={styles.activeRoute}>
            <Text style={styles.routeLabel}>To:</Text>
            <Text style={styles.routeLocation}>{passenger.dropoff?.name || "Unknown"}</Text>
          </View>
          <Text style={styles.rideStatus}>
            Status: {passenger.pickupStatus === "completed" ? 
              (passenger.dropoffStatus === "completed" ? "Completed" : "On board") : 
              "Waiting for pickup"
            }
          </Text>
        </View>
      ))}
      
      {/* Next action button */}
      {nextAction && (
        <TouchableOpacity
          style={[styles.actionBtn, styles.nextActionBtn]}
          onPress={() => onNextStop(ride.id)}
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
  const { 
    currentUser, 
    showToast,
    // Rider store state
    isRiderOnline,
    rideRequests,
    activeRides,
    riderEarnings,
    setRiderOnlineStatus,
    setRideRequests,
    setActiveRides,
    setRiderEarnings,
    acceptRideRequest: moveRequestToActive,
    removeRideRequest,
    updateActiveRide,
    completeRide,
  } = useStore();

  // Local loading states only
  const [statusLoading, setStatusLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Refs for cleanup
  const requestsUnsubscribe = useRef(null);
  const ridesUnsubscribe = useRef(null);
  const earningsUnsubscribe = useRef(null);
  const locationWatcherRef = useRef(null);
  const prevRequestCountRef = useRef(0);

  const riderId = currentUser?.uid;

  // ── Notify rider on new requests ──────────────────────────────────────────
  useEffect(() => {
    const prev = prevRequestCountRef.current;
    const curr = rideRequests.length;
    if (curr > prev && isRiderOnline) {
      sendLocalNotification(
        "New Ride Request!",
        "A student needs a ride. Open the app to accept.",
        { type: "newRequest" }
      );
    }
    prevRequestCountRef.current = curr;
  }, [rideRequests.length]);

  // ── GPS location broadcaster ───────────────────────────────────────────────
  // Watches rider's position and writes to Firestore whenever they are online
  // and have active rides. Cleans up watcher on unmount or when conditions change.
  useEffect(() => {
    let active = true;

    async function startWatching() {
      // Only broadcast when online and has active rides
      if (!riderId || !isRiderOnline || activeRides.length === 0) {
        // Stop any existing watcher if conditions no longer met
        if (locationWatcherRef.current) {
          locationWatcherRef.current.remove();
          locationWatcherRef.current = null;
        }
        return;
      }

      // Request foreground location permission
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted" || !active) return;

      // Stop any existing watcher before starting a new one
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }

      locationWatcherRef.current = await Location.watchPositionAsync(
        {
          accuracy:     Location.Accuracy.Balanced,
          timeInterval: 5000,   // minimum 5 seconds between updates
          distanceInterval: 5,  // or at least 5 metres moved
        },
        async (position) => {
          if (!active) return;
          const { latitude, longitude, heading } = position.coords;
          try {
            await setDoc(
              doc(db, "rideLocations", riderId),
              {
                riderId,
                lat:       latitude,
                lng:       longitude,
                heading:   heading ?? 0,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (err) {
            // Silent fail — location updates are best-effort
            console.warn("[RiderHome] location write failed:", err);
          }
        }
      );
    }

    startWatching();

    return () => {
      active = false;
      if (locationWatcherRef.current) {
        locationWatcherRef.current.remove();
        locationWatcherRef.current = null;
      }
    };
  }, [riderId, isRiderOnline, activeRides.length]);

  // ── Initialize data and listeners ─────────────────────────────────────────
  useEffect(() => {
    if (!riderId) return;

    // Load initial rider status
    getRiderStatus(riderId).then((status) => {
      setRiderOnlineStatus(status.isOnline);
    });

    // Fetch initial stats and sync to store
    fetchRiderStats(riderId)
      .then((stats) => {
        setRiderEarnings(stats);
      })
      .finally(() => setStatsLoading(false));

    // Set up listeners that sync to store
    if (isRiderOnline) {
      requestsUnsubscribe.current = listenToRideRequests(riderId, setRideRequests);
    }
    
    ridesUnsubscribe.current = listenToActiveRides(riderId, setActiveRides);
    earningsUnsubscribe.current = listenToRiderEarnings(riderId, setRiderEarnings);

    // Cleanup
    return () => {
      requestsUnsubscribe.current?.();
      ridesUnsubscribe.current?.();
      earningsUnsubscribe.current?.();
    };
  }, [riderId, isRiderOnline]);

  // ── Status toggle ─────────────────────────────────────────────────────────
  async function handleStatusToggle() {
    if (!riderId) return;
    
    setStatusLoading(true);
    try {
      const newStatus = !isRiderOnline;
      const result = await setRiderStatus(riderId, newStatus);
      
      if (result.success) {
        setRiderOnlineStatus(newStatus);
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
        // Find the request and create ride data for store
        const request = rideRequests.find(r => r.id === requestId);
        if (request) {
          const rideData = {
            id: result.rideId,
            requestId,
            studentId: request.studentId,
            studentName: request.studentName,
            pickup: request.pickup,
            dropoff: request.dropoff,
            status: "matched",
            pickupStatus: "pending",
            dropoffStatus: "pending",
          };
          moveRequestToActive(requestId, rideData);
        }
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
      removeRideRequest(requestId);
      showToast("Request declined", "info");
    }
  }

  // ── Active ride handlers ──────────────────────────────────────────────────
  async function handleNextStopComplete(rideId) {
    setActionLoading(true);
    try {
      const result = await completeNextStop(rideId);
      if (result.success) {
        if (result.isCompleted) {
          // Ride fully completed
          completeRide(rideId);
          showToast(`Ride completed! Earned ${formatNaira(result.earned)}`, "success");
          // Refresh stats in store
          const newStats = await fetchRiderStats(riderId);
          setRiderEarnings(newStats);
        } else {
          // Just completed one stop
          const action = result.stopType === "pickup" ? "Pickup" : "Dropoff";
          showToast(`${action} completed for ${result.passengerName}`, "success");
        }
      } else {
        showToast(result.error || "Action failed", "error");
      }
    } catch (error) {
      showToast("Stop completion failed", "error");
    } finally {
      setActionLoading(false);
    }
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
          <StatusBadge isOnline={isRiderOnline} />
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
              value={isRiderOnline}
              onValueChange={handleStatusToggle}
              trackColor={{ false: C.border, true: C.greenMute }}
              thumbColor={isRiderOnline ? C.green : C.sub}
            />
          )}
        </View>

        {/* ── Earnings Summary ────────────────────────────────── */}
        <EarningsCard stats={riderEarnings} loading={statsLoading} />

        {/* ── Ride Requests ───────────────────────────────────── */}
        {isRiderOnline && rideRequests.length > 0 && (
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
                onNextStop={handleNextStopComplete}
                actionLoading={actionLoading}
              />
            ))}
          </View>
        )}

        {/* ── Map View ────────────────────────────────────────── */}
        {(activeRides.length > 0 || rideRequests.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Map</Text>
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                initialRegion={{
                  latitude: 7.3775,
                  longitude: 3.9470,
                  latitudeDelta: 0.05,
                  longitudeDelta: 0.05,
                }}
                mapType="none"
                showsUserLocation={true}
                followsUserLocation={true}
                showsMyLocationButton={true}
              >
                {/* Pickup markers for pending requests */}
                {rideRequests.map((request) => (
                  <Marker
                    key={`request-${request.id}`}
                    coordinate={{
                      latitude: request.pickup?.lat || 0,
                      longitude: request.pickup?.lng || 0,
                    }}
                    title={`Pickup: ${request.studentName}`}
                    description={request.pickup?.name || "Pickup location"}
                    pinColor="orange"
                  />
                ))}

                {/* Active ride markers */}
                {activeRides.map((ride) => {
                  const markers = [];
                  
                  // Pickup marker (if not completed)
                  if (ride.pickupStatus === "pending") {
                    markers.push(
                      <Marker
                        key={`pickup-${ride.id}`}
                        coordinate={{
                          latitude: ride.pickup?.lat || 0,
                          longitude: ride.pickup?.lng || 0,
                        }}
                        title={`Pick up ${ride.studentName}`}
                        description={ride.pickup?.name || "Pickup location"}
                        pinColor="yellow"
                      />
                    );
                  }

                  // Dropoff marker
                  if (ride.pickupStatus === "completed" && ride.dropoffStatus === "pending") {
                    markers.push(
                      <Marker
                        key={`dropoff-${ride.id}`}
                        coordinate={{
                          latitude: ride.dropoff?.lat || 0,
                          longitude: ride.dropoff?.lng || 0,
                        }}
                        title={`Drop off ${ride.studentName}`}
                        description={ride.dropoff?.name || "Dropoff location"}
                        pinColor="green"
                      />
                    );
                  }

                  return markers;
                })}
              </MapView>
            </View>
          </View>
        )}

        {/* ── Empty States ────────────────────────────────────── */}
        {!isRiderOnline && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>You're Offline</Text>
            <Text style={styles.emptySub}>Turn on online status to receive ride requests</Text>
          </View>
        )}

        {isRiderOnline && rideRequests.length === 0 && activeRides.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No Active Requests</Text>
            <Text style={styles.emptySub}>Stay online to receive ride requests from students</Text>
          </View>
        )}

      </ScrollView>
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
  
  passengerName:    { color: C.text, fontSize: 14, fontWeight: "600", marginBottom: 4 },
  passengerDivider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  
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

  // Map styles
  mapContainer: {
    height:          200,
    borderRadius:    12,
    overflow:        "hidden",
    borderWidth:     1,
    borderColor:     C.border,
    backgroundColor: "#0F0F13",
  },
  map: { 
    flex: 1,
  },
});