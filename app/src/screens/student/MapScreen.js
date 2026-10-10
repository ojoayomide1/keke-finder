/**
 * MapScreen.js — Full screen map with contextual bottom sheet
 *
 * Map always visible. Bottom sheet appears only when:
 *  - Active ride (matched/onTrip)  → ride status + pay/cancel
 *  - Walk route active             → from/to + distance + clear
 *
 * Map follows:
 *  - Rider location when active ride
 *  - User location when walk route is active
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "../../components/MapView";
import * as Location from "expo-location";

import useStore from "../../store";
import { db, doc, onSnapshot } from "../../config/firebase";
import {
  loadCampusDataFromFirestore,
  listenToCampusData,
  getCampusLocationsForMap,
  getRideStops,
  getCampusCategoryMeta,
  getCampusPaths,
  getCampusBuildings,
} from "../../services/campus-data";
import { formatNaira } from "../../services/ride-helpers";
import { calculateCampusRoute } from "../../services/campus-router";
import {
  cancelRide,
  payForRide,
} from "../../services/student";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:      "#F7F8FA",
  surface: "#FFFFFF",
  border:  "#E2E6ED",
  green:   "#1E7A46",
  red:     "#ef4444",
  orange:  "#FF5E1A",
  text:    "#0F1117",
  sub:     "#6B7280",
};

const SHEET_COLLAPSED = 80;
const SHEET_EXPANDED  = 360;

const CATEGORY_EMOJI = {
  boys_hostel:  "🛏️",
  girls_hostel: "🛏️",
  faculty:      "🎓",
  block:        "🏢",
  hall:         "🏛️",
  restaurant:   "🍽️",
  gate:         "🚧",
  sport:        "⚽",
  service:      "ℹ️",
  pickup:       "🛺",
};

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function MapScreen() {
  const {
    currentUser,
    currentRideId, currentRequestId, latestRide,
    clearRideState, showToast,
    walkRoute, walkOriginId, clearWalkRoute,
  } = useStore();

  const mapRef = useRef(null);

  // Map data
  const [locations,       setLocations]       = useState([]);
  const [rideStops,       setRideStops]       = useState([]);
  const [campusPaths,     setCampusPaths]     = useState([]);
  const [campusBuildings, setCampusBuildings] = useState([]);
  const [userLocation,    setUserLocation]    = useState(null);
  const [zoomDelta,       setZoomDelta]       = useState(0.012);

  // Rider live location
  const [riderLocation,   setRiderLocation]   = useState(null);

  // Ride state (mirrored from store for pay/cancel)
  const [ridePhase,   setRidePhase]   = useState("idle");
  const [liveSummary, setLiveSummary] = useState(null);
  const [payingNow,   setPayingNow]   = useState(false);
  const [cancelling,  setCancelling]  = useState(false);

  // Sheet
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const hasSheet = ridePhase !== "idle" || !!walkRoute;

  const unsubCampusRef       = useRef(null);
  const unsubRiderLocRef     = useRef(null);

  // ── Load campus data ────────────────────────────────────────────────────
  useEffect(() => {
    loadCampusDataFromFirestore().then(() => {
      setLocations(getCampusLocationsForMap());
      setRideStops(getRideStops());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });
    unsubCampusRef.current = listenToCampusData(() => {
      setLocations(getCampusLocationsForMap());
      setRideStops(getRideStops());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });

        // Watch position for walk route following
        await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 5 },
          (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        );
      }
    })();

    return () => {
      unsubCampusRef.current?.();
      unsubRiderLocRef.current?.();
    };
  }, []);

  // ── Auto-center on campus once data loads ───────────────────────────────
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (hasCenteredRef.current || !mapRef.current) return;
    const valid = [...rideStops, ...locations].filter(l => l.lat && l.lng);
    if (valid.length === 0) return;
    hasCenteredRef.current = true;
    const coords = valid.map(l => ({ latitude: l.lat, longitude: l.lng }));
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 60, right: 40, bottom: 160, left: 40 },
        animated: true,
      });
    }, 800);
  }, [locations.length, rideStops.length]);

  // ── Watch ride state from store ─────────────────────────────────────────
  useEffect(() => {
    if (latestRide) {
      setLiveSummary(latestRide);
      if (latestRide.pickupStatus === "completed") setRidePhase("onTrip");
      else setRidePhase("matched");
    } else if (currentRideId) {
      setRidePhase("matched");
    } else {
      setRidePhase("idle");
      setLiveSummary(null);
    }
  }, [latestRide, currentRideId]);

  // ── Listen to rider location when active ride ───────────────────────────
  useEffect(() => {
    const riderId = latestRide?.riderId;
    unsubRiderLocRef.current?.();
    unsubRiderLocRef.current = null;

    if (!riderId || ridePhase === "idle") {
      setRiderLocation(null);
      return;
    }

    unsubRiderLocRef.current = onSnapshot(
      doc(db, "rideLocations", riderId),
      (snap) => {
        if (snap.exists()) {
          setRiderLocation({ lat: snap.data().lat, lng: snap.data().lng });
        }
      }
    );
  }, [latestRide?.riderId, ridePhase]);

  // ── Auto-center map on rider or user location ───────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;

    if (ridePhase !== "idle" && riderLocation) {
      mapRef.current.animateToRegion({
        latitude: riderLocation.lat,
        longitude: riderLocation.lng,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      }, 800);
    } else if (walkRoute && userLocation) {
      mapRef.current.animateToRegion({
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }, 800);
    }
  }, [riderLocation, walkRoute, userLocation]);

  // ── Show/hide bottom sheet based on whether there's something active ────
  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: hasSheet ? 1 : 0,
      useNativeDriver: false,
      tension: 200,
      friction: 8,
    }).start();
  }, [hasSheet]);

  // ── Pan responder for sheet drag ────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 10,
      onPanResponderGrant: () => {
        sheetAnim.setOffset(sheetAnim._value);
        sheetAnim.setValue(0);
      },
      onPanResponderMove: (_, gs) => {
        sheetAnim.setValue(-gs.dy / (SHEET_EXPANDED - SHEET_COLLAPSED));
      },
      onPanResponderRelease: (_, gs) => {
        sheetAnim.flattenOffset();
        const toValue = gs.vy > 0.5 ? 0 : gs.vy < -0.5 ? 1 : sheetAnim._value > 0.5 ? 1 : 0;
        Animated.spring(sheetAnim, { toValue, useNativeDriver: false, tension: 200, friction: 8 }).start();
      },
    })
  ).current;

  const sheetHeight = sheetAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [SHEET_COLLAPSED, SHEET_EXPANDED],
  });

  // ── Pay/cancel ──────────────────────────────────────────────────────────
  async function handlePay() {
    if (payingNow || !currentRideId) return;
    setPayingNow(true);
    try {
      await payForRide({ rideId: currentRideId, studentId: currentUser.uid });
      showToast("Payment successful!", "success");
    } catch (err) {
      showToast(err.message === "INSUFFICIENT_BALANCE" ? "Insufficient balance. Top up first." : "Payment failed.", "error");
    } finally {
      setPayingNow(false);
    }
  }

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelRide({ requestId: currentRequestId, rideId: currentRideId, studentId: currentUser.uid });
      setRidePhase("idle");
      clearRideState();
      setLiveSummary(null);
      showToast("Ride cancelled.", "info");
    } catch (err) {
      showToast(err.message === "ALREADY_PICKED_UP" ? "Cannot cancel after pickup." : "Cancel failed.", "error");
    } finally {
      setCancelling(false);
    }
  }

  // ── Map region ──────────────────────────────────────────────────────────
  const mapRegion = useMemo(() => {
    const valid = [...rideStops, ...locations].filter(l => l.lat && l.lng);
    if (valid.length > 0) {
      const avgLat = valid.reduce((s, l) => s + l.lat, 0) / valid.length;
      const avgLng = valid.reduce((s, l) => s + l.lng, 0) / valid.length;
      return { latitude: avgLat, longitude: avgLng, latitudeDelta: 0.012, longitudeDelta: 0.012 };
    }
    return { latitude: 6.9, longitude: 4.95, latitudeDelta: 0.012, longitudeDelta: 0.012 };
  }, [rideStops.length, locations.length]);

  // On web: pass static campus geometry as a direct prop to avoid creating
  // thousands of React elements as children (which stalls the browser).
  // rideStops only included when there's an active ride — they shouldn't be
  // visible on the map when idle.
  const webCampusData = useMemo(() =>
    Platform.OS === "web"
      ? {
          buildings: campusBuildings,
          paths:     campusPaths,
          locations,
          rideStops: ridePhase !== "idle" ? rideStops : [],
        }
      : null,
    [campusBuildings, campusPaths]
  );

  // On native: memoize static map layers as children (react-native-maps API)
  const campusPathPolylines = useMemo(() =>
    Platform.OS === "web" ? [] :
    campusPaths.map((path, i) => (
      <Polyline
        key={`p-${i}`}
        coordinates={path.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
        strokeColor="#E2E6ED"
        strokeWidth={3}
      />
    )),
    [campusPaths]
  );

  const campusBuildingPolylines = useMemo(() =>
    Platform.OS === "web" ? [] :
    campusBuildings.map((b, i) => {
      const coords = b.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
      return (
        <Polyline key={`b-${i}`} coordinates={[...coords, coords[0]]} strokeColor="#3a3a45" strokeWidth={1.5} />
      );
    }),
    [campusBuildings]
  );

  // Campus and pickup/drop-off markers are intentionally hidden on the student map.
  const locationMarkers = [];
  const stopMarkers = [];

  // Walk route polyline coords
  const walkCoords = useMemo(
    () => walkRoute?.points?.map(([lat, lng]) => ({ latitude: lat, longitude: lng })) ?? [],
    [walkRoute]
  );

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── MAP ────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={mapRegion}
        mapType="none"
        showsUserLocation
        showsMyLocationButton={false}
        onRegionChange={r => setZoomDelta(r.latitudeDelta)}
        campusData={webCampusData}
      >
        {/* Static campus layers — native only (web uses campusData prop instead) */}
        {campusPathPolylines}
        {campusBuildingPolylines}

        {/* Markers - zoom gated + memoized */}
        {zoomDelta < 0.018 && locationMarkers}
        {/* Stop markers only visible when student has an active ride */}
        {zoomDelta < 0.018 && ridePhase !== "idle" && stopMarkers}

        {/* Dashed line from stop to destination building when on trip */}
        {ridePhase === "onTrip" && liveSummary?.dropoffLat && liveSummary?.dropoffLng && riderLocation && (() => {
          const route = calculateCampusRoute(
            { lat: riderLocation.lat, lng: riderLocation.lng },
            { lat: liveSummary.dropoffLat, lng: liveSummary.dropoffLng },
            { mode: "drive" }
          );
          const coords = route.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          return coords.length >= 2 ? (
            <Polyline
              coordinates={coords}
              strokeColor="rgba(30,122,70,0.65)"
              strokeWidth={3}
              lineDashPattern={route.routed ? undefined : [6, 5]}
            />
          ) : null;
        })()}

        {/* Live rider marker */}
        {riderLocation && (
          <Marker coordinate={{ latitude: riderLocation.lat, longitude: riderLocation.lng }} title="Your Rider">
            <View style={styles.riderMarker}>
              <Text style={{ fontSize: 20 }}>🛺</Text>
            </View>
          </Marker>
        )}

        {/* Walk route polyline */}
        {walkCoords.length >= 2 && (
          <Polyline
            coordinates={walkCoords}
            strokeColor={walkRoute.routed ? C.green : C.orange}
            strokeWidth={4}
            lineDashPattern={walkRoute.routed ? undefined : [8, 6]}
          />
        )}
      </MapView>

      {/* ── Recenter button ───────────────────────────────────────── */}
      {userLocation && (
        <TouchableOpacity
          style={styles.recenterBtn}
          onPress={() => mapRef.current?.animateToRegion({
            latitude: userLocation.lat,
            longitude: userLocation.lng,
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
          }, 600)}
        >
          <Text style={{ fontSize: 20 }}>⊕</Text>
        </TouchableOpacity>
      )}

      {/* ── BOTTOM SHEET — only when something is active ────────── */}
      {hasSheet && (
        <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
          {/* Drag handle — tap toggles, drag works on native */}
          <TouchableOpacity
            style={styles.handleArea}
            activeOpacity={0.7}
            onPress={() => {
              const toValue = sheetAnim._value > 0.5 ? 0 : 1;
              Animated.spring(sheetAnim, { toValue, useNativeDriver: false, tension: 200, friction: 8 }).start();
            }}
            {...(Platform.OS !== "web" ? panResponder.panHandlers : {})}
          >
            <View style={styles.handle} />
            <Text style={styles.handleHint}>
              {sheetAnim._value > 0.5 ? "▼ Collapse" : "▲ Expand"}
            </Text>
          </TouchableOpacity>

          {/* Scrollable content so nothing gets cut off */}
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

          {/* ── Active ride content */}
          {ridePhase !== "idle" && liveSummary && (
            <>
              <View style={styles.rideBanner}>
                <Text style={styles.rideBannerTitle}>
                  {ridePhase === "onTrip" ? "On Trip" : "Keke is on the way"}
                </Text>
                <Text style={styles.rideBannerSub}>
                  {ridePhase === "onTrip"
                    ? `To ${liveSummary.dropoffLabel ?? "destination"}`
                    : `${liveSummary.stopsAway} stop${liveSummary.stopsAway !== 1 ? "s" : ""} away`
                  }
                </Text>
              </View>

              <View style={styles.rideRow}>
                <Text style={styles.rideRowLabel}>Rider</Text>
                <Text style={styles.rideRowValue}>{liveSummary.riderName ?? "—"}</Text>
              </View>
              <View style={styles.rideRow}>
                <Text style={styles.rideRowLabel}>Fare</Text>
                <Text style={styles.rideRowValue}>{formatNaira(liveSummary.fare)}</Text>
              </View>
              {riderLocation && (
                <View style={styles.rideRow}>
                  <Text style={styles.rideRowLabel}>Distance</Text>
                  <Text style={styles.rideRowValue}>
                    {liveSummary.distanceToPickup != null && liveSummary.distanceToPickup <= 50
                      ? "Arriving now!"
                      : `${Math.round(liveSummary.distanceToPickup ?? 0)}m away`
                    }
                  </Text>
                </View>
              )}

              {ridePhase === "onTrip" ? (
                liveSummary.paymentMethod === "cash" ? (
                  <View style={styles.cashNotice}>
                    <Text style={styles.cashNoticeTitle}>Cash Payment</Text>
                    <Text style={styles.cashNoticeSub}>Pay the rider {formatNaira(liveSummary.fare)} in cash at drop-off</Text>
                  </View>
                ) : liveSummary.paid ? (
                  <View style={[styles.primaryBtn, { opacity: 0.6 }]}>
                    <Text style={styles.primaryBtnText}>Paid {formatNaira(liveSummary.fare)}</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.primaryBtn} onPress={handlePay} disabled={payingNow}>
                    {payingNow ? <ActivityIndicator color="#F7F8FA" /> : <Text style={styles.primaryBtnText}>Pay Now {formatNaira(liveSummary.fare)}</Text>}
                  </TouchableOpacity>
                )
              ) : (
                <TouchableOpacity style={styles.dangerBtn} onPress={handleCancel} disabled={cancelling}>
                  {cancelling ? <ActivityIndicator color={C.red} /> : <Text style={styles.dangerBtnText}>Cancel Ride</Text>}
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── Walk route content */}
          {ridePhase === "idle" && walkRoute && (
            <>
              <View style={styles.walkHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walkTitle}>Walking Route</Text>
                  <Text style={styles.walkSub}>
                    {walkOriginId === null ? "Current location" : walkRoute.originName ?? "Origin"} → {walkRoute.destName ?? "Destination"}
                  </Text>
                </View>
                <TouchableOpacity onPress={clearWalkRoute} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.walkStats}>
                <View style={styles.walkStat}>
                  <Text style={styles.walkStatValue}>
                    {walkRoute.distance != null ? (walkRoute.distance >= 1000 ? `${(walkRoute.distance / 1000).toFixed(1)}km` : `${Math.round(walkRoute.distance)}m`) : "—"}
                  </Text>
                  <Text style={styles.walkStatLabel}>Distance</Text>
                </View>
                <View style={styles.walkDivider} />
                <View style={styles.walkStat}>
                  <Text style={styles.walkStatValue}>
                    {walkRoute.distance != null ? (Math.round(walkRoute.distance / 80) < 1 ? "< 1 min" : `${Math.round(walkRoute.distance / 80)} min`) : "—"}
                  </Text>
                  <Text style={styles.walkStatLabel}>Walk time</Text>
                </View>
                <View style={styles.walkDivider} />
                <View style={styles.walkStat}>
                  <Text style={[styles.walkStatValue, { color: walkRoute.routed ? C.green : C.orange }]}>
                    {walkRoute.routed ? "Mapped" : "Straight"}
                  </Text>
                  <Text style={styles.walkStatLabel}>Route type</Text>
                </View>
              </View>
            </>
          )}

          </ScrollView>
        </Animated.View>
      )}

    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  map:  { flex: 1, backgroundColor: C.bg },

  markerWrap:   { alignItems: "center" },
  markerBubble: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  markerEmoji:  { fontSize: 14 },
  markerLabel:  { color: "#FFF", fontSize: 9, fontWeight: "700", backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 3, marginTop: 2, maxWidth: 90, textAlign: "center" },

  riderMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(30,122,70,0.2)", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.green },

  recenterBtn: { position: "absolute", top: 60, right: 16, backgroundColor: C.surface, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },

  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  handleArea: { alignItems: "center", paddingTop: 10, paddingBottom: 6 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
  handleHint: { color: C.sub, fontSize: 10, marginTop: 3 },
  sheetScroll:  { flex: 1 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: Platform.OS === "ios" ? 28 : 16 },

  rideBanner:     { backgroundColor: "rgba(30,122,70,0.08)", borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.green },
  rideBannerTitle:{ color: C.green, fontWeight: "700", fontSize: 16, marginBottom: 2 },
  rideBannerSub:  { color: C.sub, fontSize: 13 },

  rideRow:      { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  rideRowLabel: { color: C.sub, fontSize: 13 },
  rideRowValue: { color: C.text, fontSize: 13, fontWeight: "600" },

  primaryBtn:     { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  primaryBtnText: { color: "#F7F8FA", fontWeight: "700", fontSize: 15 },
  dangerBtn:      { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12, borderWidth: 1, borderColor: C.red, backgroundColor: "rgba(239,68,68,0.08)" },
  dangerBtnText:  { color: C.red, fontWeight: "600", fontSize: 15 },

  cashNotice:      { borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, padding: 14, marginTop: 12 },
  cashNoticeTitle: { color: C.text, fontWeight: "700", fontSize: 14, marginBottom: 3 },
  cashNoticeSub:   { color: C.sub, fontSize: 13 },

  walkHeader:  { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  walkTitle:   { color: C.text, fontSize: 16, fontWeight: "700" },
  walkSub:     { color: C.sub, fontSize: 13, marginTop: 2 },
  clearBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  clearBtnText:{ color: C.sub, fontSize: 13 },

  walkStats:   { flexDirection: "row", backgroundColor: C.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  walkStat:    { flex: 1, alignItems: "center" },
  walkStatValue:{ color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  walkStatLabel:{ color: C.sub, fontSize: 11 },
  walkDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },
});
