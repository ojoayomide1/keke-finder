/**
 * RiderMapScreen.js
 *
 * Full-screen map view for riders showing all pickup/dropoff locations,
 * active rides, and ride requests with better navigation UX.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Full Screen Map             │
 *  │   ├─ User location           │
 *  │   ├─ Pickup markers (🟡)     │
 *  │   ├─ Dropoff markers (🟢)    │
 *  │   └─ Request markers (🟠)    │
 *  │  Floating Info Panel         │
 *  │   ├─ Next stop info          │
 *  │   └─ Quick actions           │
 *  └──────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";

import useStore from "../../store";
import { getNextRideAction, completeNextStop } from "../../services/rider";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  orange:    "#FF5E1A",
  green:     "#00C48C",
  text:      "#FFFFFF",
  sub:       "#888",
};

// Default map region (Ibadan)
const DEFAULT_REGION = {
  latitude: 7.3775,
  longitude: 3.9470,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function NextStopPanel({ ride, onComplete, loading }) {
  const nextAction = getNextRideAction(ride);
  
  if (!nextAction) return null;

  return (
    <View style={styles.floatingPanel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Next Stop</Text>
        <Text style={styles.stopType}>
          {nextAction.type === "pickup" ? "Pickup" : "Dropoff"}
        </Text>
      </View>
      
      <Text style={styles.passengerName}>{nextAction.label}</Text>
      <Text style={styles.locationName}>{nextAction.locationLabel}</Text>
      
      <TouchableOpacity
        style={[styles.completeBtn, loading && styles.completeBtnDisabled]}
        onPress={() => onComplete(ride.id)}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#0F0F13" size="small" />
        ) : (
          <Text style={styles.completeBtnText}>
            Mark as {nextAction.type === "pickup" ? "Picked Up" : "Dropped Off"}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function StatusPanel({ rideRequests, activeRides, isOnline }) {
  return (
    <View style={styles.statusPanel}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, isOnline ? styles.onlineDot : styles.offlineDot]} />
        <Text style={styles.statusText}>
          {isOnline ? "Online" : "Offline"}
        </Text>
      </View>
      
      {isOnline && (
        <View style={styles.countsRow}>
          <Text style={styles.countText}>
            {rideRequests.length} requests • {activeRides.length} active
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function RiderMapScreen() {
  const {
    isRiderOnline,
    rideRequests,
    activeRides,
    currentUser,
    showToast,
  } = useStore();

  const [userLocation, setUserLocation] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const mapRef = useRef(null);

  // ── Get user location ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        showToast("Location permission required for map", "error");
        return;
      }

      try {
        const location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch (error) {
        console.error("Error getting location:", error);
      }
    })();
  }, []);

  // ── Handle stop completion ────────────────────────────────────────────────
  async function handleStopComplete(rideId) {
    setActionLoading(true);
    try {
      const result = await completeNextStop(rideId);
      if (result.success) {
        if (result.isCompleted) {
          showToast("Ride completed!", "success");
        } else {
          const action = result.stopType === "pickup" ? "Pickup" : "Dropoff";
          showToast(`${action} completed`, "success");
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

  // ── Get all markers ───────────────────────────────────────────────────────
  function getAllMarkers() {
    const markers = [];

    // Add ride request markers (orange)
    rideRequests.forEach((request) => {
      if (request.pickup?.lat && request.pickup?.lng) {
        markers.push(
          <Marker
            key={`request-pickup-${request.id}`}
            coordinate={{
              latitude: request.pickup.lat,
              longitude: request.pickup.lng,
            }}
            title={`Request: ${request.studentName}`}
            description={request.pickup.name || "Pickup location"}
            pinColor="orange"
          />
        );
      }
    });

    // Add active ride markers
    activeRides.forEach((ride) => {
      const stopQueue = ride.stopQueue || [];
      
      stopQueue.forEach((stop) => {
        if (stop.status === "pending" && stop.location?.lat && stop.location?.lng) {
          const isPickup = stop.type === "pickup";
          markers.push(
            <Marker
              key={`${ride.id}-${stop.stopId}`}
              coordinate={{
                latitude: stop.location.lat,
                longitude: stop.location.lng,
              }}
              title={`${isPickup ? "Pick up" : "Drop off"} ${stop.passengerName}`}
              description={stop.locationLabel || stop.location.name}
              pinColor={isPickup ? "yellow" : "green"}
            />
          );
        }
      });
    });

    return markers;
  }

  // ── Fit map to markers ────────────────────────────────────────────────────
  function fitToMarkers() {
    const allCoordinates = [];

    // Add user location
    if (userLocation) {
      allCoordinates.push(userLocation);
    }

    // Add request locations
    rideRequests.forEach((request) => {
      if (request.pickup?.lat && request.pickup?.lng) {
        allCoordinates.push({
          latitude: request.pickup.lat,
          longitude: request.pickup.lng,
        });
      }
    });

    // Add active ride locations
    activeRides.forEach((ride) => {
      const stopQueue = ride.stopQueue || [];
      stopQueue.forEach((stop) => {
        if (stop.status === "pending" && stop.location?.lat && stop.location?.lng) {
          allCoordinates.push({
            latitude: stop.location.lat,
            longitude: stop.location.lng,
          });
        }
      });
    });

    if (allCoordinates.length > 1 && mapRef.current) {
      mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
        animated: true,
      });
    }
  }

  // Fit to markers when data changes
  useEffect(() => {
    const timer = setTimeout(fitToMarkers, 1000);
    return () => clearTimeout(timer);
  }, [rideRequests, activeRides, userLocation]);

  // Get current active ride for next stop panel
  const currentRide = activeRides.find((ride) => {
    const nextAction = getNextRideAction(ride);
    return nextAction !== null;
  });

  const initialRegion = userLocation ? {
    ...userLocation,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  } : DEFAULT_REGION;

  return (
    <View style={styles.root}>
      
      {/* ── Map View ──────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType="none"
        initialRegion={initialRegion}
        showsUserLocation={true}
        followsUserLocation={false}
        showsMyLocationButton={true}
        showsTraffic={false}
        showsBuildings={false}
      >
        {getAllMarkers()}
      </MapView>

      {/* ── Status Panel ──────────────────────────────────────── */}
      <StatusPanel
        rideRequests={rideRequests}
        activeRides={activeRides}
        isOnline={isRiderOnline}
      />

      {/* ── Next Stop Panel ───────────────────────────────────── */}
      {currentRide && (
        <NextStopPanel
          ride={currentRide}
          onComplete={handleStopComplete}
          loading={actionLoading}
        />
      )}

      {/* ── Fit to Markers Button ─────────────────────────────── */}
      {(rideRequests.length > 0 || activeRides.length > 0) && (
        <TouchableOpacity
          style={styles.fitButton}
          onPress={fitToMarkers}
        >
          <Text style={styles.fitButtonText}>📍</Text>
        </TouchableOpacity>
      )}

    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  map:  { flex: 1, backgroundColor: C.bg },

  // Status panel (top)
  statusPanel: {
    position:        "absolute",
    top:             60,
    left:            20,
    right:           20,
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         12,
    borderWidth:     1,
    borderColor:     C.border,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.25,
    shadowRadius:    4,
    elevation:       5,
  },
  statusRow: {
    flexDirection: "row",
    alignItems:    "center",
    marginBottom:  4,
  },
  statusDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
    marginRight:  8,
  },
  onlineDot:  { backgroundColor: C.green },
  offlineDot: { backgroundColor: C.sub },
  statusText: { color: C.text, fontSize: 16, fontWeight: "600" },
  countsRow:  { marginTop: 4 },
  countText:  { color: C.sub, fontSize: 14 },

  // Next stop panel (bottom)
  floatingPanel: {
    position:        "absolute",
    bottom:          100,
    left:            20,
    right:           20,
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         20,
    borderWidth:     1,
    borderColor:     C.border,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.3,
    shadowRadius:    6,
    elevation:       8,
  },
  panelHeader: {
    flexDirection:  "row",
    justifyContent: "space-between",
    alignItems:     "center",
    marginBottom:   12,
  },
  panelTitle: { color: C.text, fontSize: 16, fontWeight: "600" },
  stopType: {
    backgroundColor: C.orange + "20",
    color:           C.orange,
    paddingHorizontal: 8,
    paddingVertical:   4,
    borderRadius:      12,
    fontSize:          12,
    fontWeight:        "600",
  },
  passengerName: { color: C.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  locationName:  { color: C.sub, fontSize: 14, marginBottom: 16 },

  completeBtn: {
    backgroundColor: C.orange,
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      "center",
  },
  completeBtnDisabled: { opacity: 0.6 },
  completeBtnText:     { color: "#0F0F13", fontWeight: "700", fontSize: 16 },

  // Fit button
  fitButton: {
    position:        "absolute",
    bottom:          20,
    right:           20,
    width:           48,
    height:          48,
    backgroundColor: C.surface,
    borderRadius:    24,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     1,
    borderColor:     C.border,
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.25,
    shadowRadius:    4,
    elevation:       5,
  },
  fitButtonText: { fontSize: 20 },
});