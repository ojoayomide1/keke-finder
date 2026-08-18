/**
 * PathfinderScreen.js
 *
 * Campus walking-route map for students.
 * - Emoji markers per category, zoom-based visibility
 * - PanResponder drag on bottom sheet (same as HomeScreen)
 * - Route from current location as origin
 * - Simplified UI
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";

import {
  loadCampusDataFromFirestore,
  listenToCampusData,
  getCampusLocationsForMap,
  getCampusCategoryMeta,
  getCampusPaths,
  getCampusBuildings,
  CAMPUS_CATEGORY_META,
} from "../../services/campus-data";
import {
  calculateCampusRoute,
  getDistanceMeters,
} from "../../services/campus-router";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:      "#0F0F13",
  surface: "#1A1A22",
  border:  "#2a2a35",
  green:   "#00C48C",
  orange:  "#FF5E1A",
  text:    "#FFFFFF",
  sub:     "#888",
};

const SHEET_COLLAPSED = 100; // px - just handle + pickers visible
const SHEET_EXPANDED  = 420; // px - full panel

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDistance(m) {
  if (!m && m !== 0) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatWalkTime(m) {
  if (!m && m !== 0) return "—";
  const mins = Math.round(m / 80); // ~80m/min walking pace
  return mins < 1 ? "< 1 min" : `${mins} min`;
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function PathfinderScreen() {
  const mapRef  = useRef(null);
  const sheetAnim = useRef(new Animated.Value(0)).current; // 0=collapsed, 1=expanded

  // Data
  const [locations,       setLocations]       = useState([]);
  const [campusPaths,     setCampusPaths]     = useState([]);
  const [campusBuildings, setCampusBuildings] = useState([]);
  const [userLocation,    setUserLocation]    = useState(null);
  const [zoomDelta,       setZoomDelta]       = useState(0.012);

  // Route
  const [originId,  setOriginId]  = useState(null); // null = "current location"
  const [destId,    setDestId]    = useState(null);
  const [route,     setRoute]     = useState(null);
  const [routing,   setRouting]   = useState(false);

  const unsubCampusRef = useRef(null);

  // ── Load campus data ────────────────────────────────────────────────────
  useEffect(() => {
    loadCampusDataFromFirestore().then(() => {
      setLocations(getCampusLocationsForMap());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });

    unsubCampusRef.current = listenToCampusData(() => {
      setLocations(getCampusLocationsForMap());
      setCampusPaths(getCampusPaths());
      setCampusBuildings(getCampusBuildings());
    });

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();

    return () => unsubCampusRef.current?.();
  }, []);

  // ── Center map on campus once locations load ────────────────────────────
  useEffect(() => {
    if (locations.length === 0 || !mapRef.current) return;
    const coords = locations.map(l => ({ latitude: l.lat, longitude: l.lng }));
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: SHEET_COLLAPSED + 40, left: 40 },
        animated: true,
      });
    }, 600);
  }, [locations.length > 0]);

  // ── Calculate route ────────────────────────────────────────────────────
  useEffect(() => {
    if (!destId) { setRoute(null); return; }

    // If originId is null, use current location
    const originLoc = originId === null
      ? (userLocation ? { lat: userLocation.lat, lng: userLocation.lng, id: "_current" } : null)
      : locations.find(l => l.id === originId);

    const destLoc = locations.find(l => l.id === destId);
    if (!originLoc || !destLoc) return;

    setRouting(true);
    const id = setTimeout(() => {
      try {
        // For current location origin, create a synthetic location object
        const from = originId === null
          ? { ...originLoc, name: "Current Location" }
          : originLoc;

        const result = calculateCampusRoute(from, destLoc);
        setRoute(result);

        if (result?.points?.length >= 2 && mapRef.current) {
          const coords = result.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          // Add dest coords to make sure it's in view
          coords.push({ latitude: destLoc.lat, longitude: destLoc.lng });
          mapRef.current.fitToCoordinates(coords, {
            edgePadding: { top: 80, right: 40, bottom: SHEET_COLLAPSED + 60, left: 40 },
            animated: true,
          });
        }
      } catch (err) {
        setRoute({ points: [], distance: null, routed: false, reason: "Routing failed" });
      } finally {
        setRouting(false);
      }
    }, 50);

    return () => clearTimeout(id);
  }, [originId, destId, locations, userLocation]);

  // ── PanResponder drag for bottom sheet ─────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 10,
      onPanResponderGrant: () => {
        sheetAnim.setOffset(sheetAnim._value);
        sheetAnim.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        const drag = -gestureState.dy / (SHEET_EXPANDED - SHEET_COLLAPSED);
        sheetAnim.setValue(drag);
      },
      onPanResponderRelease: (_, gestureState) => {
        sheetAnim.flattenOffset();
        const velocity = gestureState.vy;
        const current  = sheetAnim._value;
        let toValue;
        if (velocity > 0.5)       toValue = 0;
        else if (velocity < -0.5) toValue = 1;
        else                      toValue = current > 0.5 ? 1 : 0;

        Animated.spring(sheetAnim, {
          toValue,
          useNativeDriver: false,
          tension: 200,
          friction: 8,
        }).start();
      },
    })
  ).current;

  const sheetHeight = sheetAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [SHEET_COLLAPSED, SHEET_EXPANDED],
  });

  // ── Derived data ───────────────────────────────────────────────────────
  const mapRegion = useMemo(() => {
    const valid = locations.filter(l => l.lat && l.lng);
    if (valid.length > 0) {
      const avgLat = valid.reduce((s, l) => s + l.lat, 0) / valid.length;
      const avgLng = valid.reduce((s, l) => s + l.lng, 0) / valid.length;
      return { latitude: avgLat, longitude: avgLng, latitudeDelta: 0.012, longitudeDelta: 0.012 };
    }
    return { latitude: 6.9, longitude: 4.95, latitudeDelta: 0.012, longitudeDelta: 0.012 };
  }, [locations]);

  const routeCoords = useMemo(
    () => route?.points?.map(([lat, lng]) => ({ latitude: lat, longitude: lng })) ?? [],
    [route]
  );

  const originLabel = originId === null
    ? "Current Location"
    : locations.find(l => l.id === originId)?.name ?? "Select origin";

  const destLabel = locations.find(l => l.id === destId)?.name ?? "Select destination";

  // ─── RENDER ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>

      {/* ── MAP ──────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={mapRegion}
          mapType="none"
          showsUserLocation
          showsMyLocationButton={false}
          onRegionChange={r => setZoomDelta(r.latitudeDelta)}
        >
          {/* Campus roads */}
          {campusPaths.map((path, i) => (
            <Polyline
              key={`path-${i}`}
              coordinates={path.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))}
              strokeColor="#2a2a35"
              strokeWidth={3}
            />
          ))}

          {/* Campus buildings */}
          {campusBuildings.map((building, i) => {
            const coords = building.points.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
            return (
              <Polyline
                key={`building-${i}`}
                coordinates={[...coords, coords[0]]}
                strokeColor="#3a3a45"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Location markers — show at medium zoom */}
          {zoomDelta < 0.018 && locations.map(loc => {
            const meta     = getCampusCategoryMeta(loc.category);
            const isOrigin = loc.id === originId;
            const isDest   = loc.id === destId;
            const color    = isOrigin ? C.green : isDest ? C.orange : meta.color;
            return (
              <Marker
                key={loc.id}
                coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                title={loc.name}
              >
                <View style={styles.markerWrap}>
                  <View style={[styles.markerBubble, { backgroundColor: color, borderColor: (isOrigin || isDest) ? "#FFFFFF" : "rgba(255,255,255,0.3)" }]}>
                    <Text style={styles.markerEmoji}>
                      {isOrigin ? "📍" : isDest ? "🏁" : (CATEGORY_EMOJI[loc.category] ?? "📍")}
                    </Text>
                  </View>
                  {zoomDelta < 0.009 && (
                    <Text style={styles.markerLabel} numberOfLines={1}>
                      {loc.name.length > 14 ? loc.name.slice(0, 14) + "…" : loc.name}
                    </Text>
                  )}
                </View>
              </Marker>
            );
          })}

          {/* Route polyline */}
          {routeCoords.length >= 2 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor={route?.routed ? C.green : C.orange}
              strokeWidth={4}
              lineDashPattern={route?.routed ? undefined : [8, 6]}
            />
          )}
        </MapView>

        {/* Recenter button */}
        {userLocation && (
          <TouchableOpacity
            style={styles.recenterBtn}
            onPress={() => mapRef.current?.animateToRegion({
              latitude:       userLocation.lat,
              longitude:      userLocation.lng,
              latitudeDelta:  0.005,
              longitudeDelta: 0.005,
            }, 600)}
          >
            <Text style={styles.recenterIcon}>⊕</Text>
          </TouchableOpacity>
        )}

        {routing && (
          <View style={styles.routingBadge}>
            <ActivityIndicator size="small" color={C.green} />
            <Text style={styles.routingText}>Calculating…</Text>
          </View>
        )}
      </View>

      {/* ── BOTTOM SHEET ─────────────────────────────────────────── */}
      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>

        {/* Drag handle area */}
        <TouchableOpacity
          style={styles.handleArea}
          onPress={() => {
            const toValue = sheetAnim._value > 0.5 ? 0 : 1;
            Animated.spring(sheetAnim, { toValue, useNativeDriver: false, tension: 200, friction: 8 }).start();
          }}
          activeOpacity={1}
          {...panResponder.panHandlers}
        >
          <View style={styles.handle} />
        </TouchableOpacity>

        {/* Origin / Dest row — always visible */}
        <View style={styles.routeRow}>
          {/* Origin picker */}
          <View style={styles.routePicker}>
            <Text style={styles.routePickerLabel}>From</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.originScroll}>
              {/* Current location option */}
              <TouchableOpacity
                style={[styles.originChip, originId === null && styles.originChipActive]}
                onPress={() => setOriginId(null)}
              >
                <Text style={[styles.originChipText, originId === null && styles.originChipTextActive]}>
                  📍 Current Location
                </Text>
              </TouchableOpacity>
              {/* Location options */}
              {locations.map(loc => (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.originChip, originId === loc.id && styles.originChipActive]}
                  onPress={() => setOriginId(loc.id)}
                >
                  <Text style={[styles.originChipText, originId === loc.id && styles.originChipTextActive]}>
                    {CATEGORY_EMOJI[loc.category] ?? "📍"} {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Swap */}
          <TouchableOpacity
            style={styles.swapBtn}
            onPress={() => {
              if (originId !== null) {
                setOriginId(destId);
                setDestId(originId);
              }
            }}
          >
            <Text style={styles.swapIcon}>⇄</Text>
          </TouchableOpacity>

          {/* Dest picker */}
          <View style={styles.routePicker}>
            <Text style={styles.routePickerLabel}>To</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.originScroll}>
              {locations.map(loc => (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.destChip, destId === loc.id && styles.destChipActive]}
                  onPress={() => setDestId(loc.id)}
                >
                  <Text style={[styles.destChipText, destId === loc.id && styles.destChipTextActive]}>
                    {CATEGORY_EMOJI[loc.category] ?? "📍"} {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {/* Route summary — shown when expanded and route exists */}
        {route && (
          <View style={styles.routeSummary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{formatDistance(route.distance)}</Text>
              <Text style={styles.summaryLabel}>Distance</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{formatWalkTime(route.distance)}</Text>
              <Text style={styles.summaryLabel}>Walk time</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: route.routed ? C.green : C.orange }]}>
                {route.routed ? "Mapped" : "Straight line"}
              </Text>
              <Text style={styles.summaryLabel}>Route type</Text>
            </View>
          </View>
        )}

        {/* Clear button */}
        {(originId || destId) && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => { setOriginId(null); setDestId(null); setRoute(null); }}
          >
            <Text style={styles.clearBtnText}>Clear Route</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  mapContainer: { flex: 1, backgroundColor: C.bg },

  // Markers
  markerWrap:   { alignItems: "center" },
  markerBubble: {
    width:          30,
    height:         30,
    borderRadius:   15,
    alignItems:     "center",
    justifyContent: "center",
    borderWidth:    2,
  },
  markerEmoji:  { fontSize: 14 },
  markerLabel:  {
    color:             "#FFFFFF",
    fontSize:          9,
    fontWeight:        "700",
    backgroundColor:   "rgba(0,0,0,0.75)",
    paddingHorizontal: 3,
    paddingVertical:   1,
    borderRadius:      3,
    marginTop:         2,
    maxWidth:          90,
    textAlign:         "center",
  },

  // Overlay buttons
  recenterBtn: {
    position:        "absolute",
    top:             16,
    right:           16,
    backgroundColor: C.surface,
    borderRadius:    20,
    width:           40,
    height:          40,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     1,
    borderColor:     C.border,
  },
  recenterIcon: { fontSize: 20, color: C.text },

  routingBadge: {
    position:        "absolute",
    top:             16,
    left:            16,
    backgroundColor: C.surface,
    borderRadius:    12,
    paddingHorizontal: 12,
    paddingVertical:   6,
    flexDirection:   "row",
    alignItems:      "center",
    gap:             8,
    borderWidth:     1,
    borderColor:     C.border,
  },
  routingText: { color: C.text, fontSize: 13 },

  // Bottom sheet
  sheet: {
    position:        "absolute",
    bottom:          0,
    left:            0,
    right:           0,
    backgroundColor: C.surface,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    borderWidth:     1,
    borderColor:     C.border,
    paddingHorizontal: 16,
    paddingBottom:    Platform.OS === "ios" ? 24 : 12,
  },
  handleArea: {
    alignItems:     "center",
    paddingVertical: 12,
  },
  handle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: C.border,
  },

  // Route row
  routeRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           8,
    marginBottom:  12,
  },
  routePicker: { flex: 1 },
  routePickerLabel: {
    color:        C.sub,
    fontSize:     11,
    fontWeight:   "600",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  originScroll: { flexGrow: 0 },
  originChip: {
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:      20,
    backgroundColor:   C.bg,
    borderWidth:       1,
    borderColor:       C.border,
    marginRight:       6,
  },
  originChipActive:    { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.1)" },
  originChipText:      { color: C.sub,   fontSize: 12, fontWeight: "600" },
  originChipTextActive:{ color: C.green, fontSize: 12, fontWeight: "600" },

  destChip:          { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, marginRight: 6 },
  destChipActive:    { borderColor: C.orange, backgroundColor: "rgba(255,94,26,0.1)" },
  destChipText:      { color: C.sub,    fontSize: 12, fontWeight: "600" },
  destChipTextActive:{ color: C.orange, fontSize: 12, fontWeight: "600" },

  swapBtn:  { paddingTop: 22, paddingHorizontal: 4 },
  swapIcon: { color: C.sub, fontSize: 20 },

  // Route summary
  routeSummary: {
    flexDirection:  "row",
    backgroundColor: C.bg,
    borderRadius:   12,
    padding:        12,
    marginBottom:   12,
    borderWidth:    1,
    borderColor:    C.border,
  },
  summaryItem:    { flex: 1, alignItems: "center" },
  summaryValue:   { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  summaryLabel:   { color: C.sub,  fontSize: 11 },
  summaryDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },

  // Clear button
  clearBtn: {
    alignItems:      "center",
    paddingVertical: 10,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
  },
  clearBtnText: { color: C.sub, fontSize: 13, fontWeight: "600" },
});
