/**
 * PathfinderScreen.js — Campus walking route finder (full page)
 *
 * Tap a location → "Go" to set as destination from current location
 * Or tap "From here" to set as origin, then tap Go on destination
 * Auto-navigates to Map tab after 10s countdown when route is found
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Location from "expo-location";

import useStore from "../../store";
import {
  loadCampusDataFromFirestore,
  listenToCampusData,
  getCampusLocationsForMap,
  getCampusCategoryMeta,
  CAMPUS_CATEGORY_META,
} from "../../services/campus-data";
import { calculateCampusRoute } from "../../services/campus-router";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const C = {
  bg:      "#0F0F13",
  surface: "#1A1A22",
  border:  "#2a2a35",
  green:   "#00C48C",
  orange:  "#FF5E1A",
  red:     "#ef4444",
  text:    "#FFFFFF",
  sub:     "#888",
};

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

function formatDistance(m) {
  if (!m && m !== 0) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatWalkTime(m) {
  if (!m && m !== 0) return "—";
  const mins = Math.round(m / 80);
  return mins < 1 ? "< 1 min" : `${mins} min`;
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

const LocationCard = React.memo(function LocationCard({ loc, isOrigin, isDest, onGo, onSetOrigin }) {
  const meta = getCampusCategoryMeta(loc.category);
  return (
    <View style={styles.locCard}>
      <View style={[styles.locDot, { backgroundColor: meta.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.locName}>{loc.name}</Text>
        <Text style={styles.locCat}>{meta.label}</Text>
      </View>
      <View style={styles.locActions}>
        <TouchableOpacity
          style={[styles.locBtn, isOrigin && styles.locBtnActiveGreen]}
          onPress={() => onSetOrigin(isOrigin ? null : loc.id)}
        >
          <Text style={[styles.locBtnText, isOrigin && { color: C.green }]}>
            {isOrigin ? "From ✓" : "From"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.goBtn, isDest && styles.goBtnActive]}
          onPress={() => onGo(loc.id)}
        >
          <Text style={[styles.goBtnText, isDest && styles.goBtnTextActive]}>
            {isDest ? "Going" : "Go"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function PathfinderScreen({ navigation }) {
  const { setWalkRoute, setWalkOriginId, clearWalkRoute } = useStore();

  const [locations,    setLocations]    = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [originId,     setOriginId]     = useState(null); // null = current location
  const [destId,       setDestId]       = useState(null);
  const [route,        setRoute]        = useState(null);
  const [routing,      setRouting]      = useState(false);
  const [filter,       setFilter]       = useState("all");
  const [countdown,    setCountdown]    = useState(null); // null | number

  const countdownRef    = useRef(null);
  const unsubCampusRef  = useRef(null);

  // ── Load data ───────────────────────────────────────────────────────────
  useEffect(() => {
    loadCampusDataFromFirestore().then(() => setLocations(getCampusLocationsForMap()));
    unsubCampusRef.current = listenToCampusData(() => setLocations(getCampusLocationsForMap()));

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();

    return () => {
      unsubCampusRef.current?.();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Calculate route when origin+dest change ─────────────────────────────
  useEffect(() => {
    if (!destId) { setRoute(null); cancelCountdown(); return; }

    const originLoc = originId === null
      ? (userLocation ? { ...userLocation, id: "_current", name: "Current Location" } : null)
      : locations.find(l => l.id === originId);

    const destLoc = locations.find(l => l.id === destId);
    if (!originLoc || !destLoc) return;

    setRouting(true);
    cancelCountdown();
    const id = setTimeout(() => {
      try {
        const result = calculateCampusRoute(originLoc, destLoc);
        setRoute({ ...result, originName: originLoc.name, destName: destLoc.name });
        startCountdown();
      } catch {
        setRoute({ points: [], distance: null, routed: false, originName: originLoc.name, destName: destLoc.name });
      } finally {
        setRouting(false);
      }
    }, 50);

    return () => clearTimeout(id);
  }, [originId, destId, locations, userLocation]);

  // ── Countdown then navigate to map ─────────────────────────────────────
  function startCountdown() {
    setCountdown(10);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }

  // When countdown reaches null after starting, navigate to map
  const didStartCountdown = useRef(false);
  useEffect(() => {
    if (route && countdown === null && didStartCountdown.current) {
      navigateToMap();
      didStartCountdown.current = false;
    }
    if (route && countdown !== null) {
      didStartCountdown.current = true;
    }
  }, [countdown, route]);

  function navigateToMap() {
    if (!route) return;
    setWalkOriginId(originId);
    setWalkRoute(route);
    navigation.navigate("Map");
  }

  function handleGoNow() {
    cancelCountdown();
    navigateToMap();
  }

  function handleCancelRoute() {
    cancelCountdown();
    setDestId(null);
    setOriginId(null);
    setRoute(null);
    clearWalkRoute();
  }

  // ── Handle Go tap on a location card ───────────────────────────────────
  const handleGo = useCallback((locId) => {
    if (locId === destId) {
      // Tapping Go again on the same dest = go now
      handleGoNow();
    } else {
      setDestId(locId);
    }
  }, [destId, route]);

  const handleSetOrigin = useCallback((locId) => {
    setOriginId(locId);
  }, []);

  // ── Filtered locations ──────────────────────────────────────────────────
  const filteredLocations = useMemo(() =>
    filter === "all" ? locations : locations.filter(l => l.category === filter),
    [locations, filter]
  );

  const originName = originId === null ? "Current Location"
    : locations.find(l => l.id === originId)?.name ?? "Select origin";

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Pathfinder</Text>
          <Text style={styles.headerSub}>Find your way around campus</Text>
        </View>
        {originId !== null && (
          <TouchableOpacity style={styles.currentLocBtn} onPress={() => setOriginId(null)}>
            <Text style={styles.currentLocBtnText}>Use Current Location</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Active route banner ─────────────────────────────────── */}
      {route && (
        <View style={styles.routeBanner}>
          <View style={styles.routeBannerInfo}>
            <Text style={styles.routeBannerTitle} numberOfLines={1}>
              {originName} → {route.destName}
            </Text>
            <Text style={styles.routeBannerStats}>
              {formatDistance(route.distance)}  ·  {formatWalkTime(route.distance)}  ·  {route.routed ? "Mapped" : "Straight line"}
            </Text>
          </View>

          <View style={styles.routeBannerActions}>
            {countdown !== null ? (
              <TouchableOpacity style={styles.goNowBtn} onPress={handleGoNow}>
                <Text style={styles.goNowBtnText}>Map ({countdown}s)</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.goNowBtn} onPress={handleGoNow}>
                <Text style={styles.goNowBtnText}>View Map</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelRouteBtn} onPress={handleCancelRoute}>
              <Text style={styles.cancelRouteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {routing && (
        <View style={styles.routingBar}>
          <ActivityIndicator size="small" color={C.green} />
          <Text style={styles.routingText}>Calculating...</Text>
        </View>
      )}

      {/* ── Category filter ─────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {[["all", "All"], ...Object.entries(CAMPUS_CATEGORY_META).map(([id, m]) => [id, m.label])].map(([id, label]) => (
          <TouchableOpacity
            key={id}
            style={[styles.filterChip, filter === id && styles.filterChipActive]}
            onPress={() => setFilter(id)}
          >
            <Text style={[styles.filterChipText, filter === id && styles.filterChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Location list ───────────────────────────────────────── */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {originId === null && (
          <View style={styles.currentLocCard}>
            <Text style={styles.currentLocLabel}>Starting from your current location</Text>
            <Text style={styles.currentLocSub}>Tap "From" on any location below to change the starting point</Text>
          </View>
        )}
        {filteredLocations.map(loc => (
          <LocationCard
            key={loc.id}
            loc={loc}
            isOrigin={loc.id === originId}
            isDest={loc.id === destId}
            onGo={handleGo}
            onSetOrigin={handleSetOrigin}
          />
        ))}
        {filteredLocations.length === 0 && (
          <Text style={styles.emptyText}>No locations in this category.</Text>
        )}
      </ScrollView>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 16,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: "700" },
  headerSub:   { color: C.sub, fontSize: 13, marginTop: 2 },

  currentLocBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: C.green },
  currentLocBtnText: { color: C.green, fontSize: 12, fontWeight: "600" },

  // Route banner
  routeBanner: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 16,
    paddingVertical:   12,
    backgroundColor:   "rgba(0,196,140,0.08)",
    borderBottomWidth: 1,
    borderBottomColor: C.green,
  },
  routeBannerInfo:   { flex: 1 },
  routeBannerTitle:  { color: C.text, fontSize: 14, fontWeight: "600" },
  routeBannerStats:  { color: C.sub, fontSize: 12, marginTop: 2 },
  routeBannerActions:{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 8 },
  goNowBtn:          { backgroundColor: C.green, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12 },
  goNowBtnText:      { color: "#0F0F13", fontWeight: "700", fontSize: 13 },
  cancelRouteBtn:    { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  cancelRouteBtnText:{ color: C.sub, fontSize: 14 },

  routingBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  routingText:{ color: C.sub, fontSize: 13 },

  // Category filter
  filterRow:    { flexGrow: 0, maxHeight: 48, borderBottomWidth: 1, borderBottomColor: C.border },
  filterContent:{ paddingHorizontal: 16, gap: 8, alignItems: "center" },
  filterChip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterChipActive:    { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.1)" },
  filterChipText:      { color: C.sub, fontSize: 12, fontWeight: "600" },
  filterChipTextActive:{ color: C.green },

  // Location list
  list:        { flex: 1 },
  listContent: { padding: 16, paddingBottom: 40 },

  currentLocCard: {
    backgroundColor: C.surface,
    borderRadius:    12,
    padding:         12,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     C.green,
    borderStyle:     "dashed",
  },
  currentLocLabel: { color: C.green, fontWeight: "600", fontSize: 13 },
  currentLocSub:   { color: C.sub, fontSize: 12, marginTop: 2 },

  locCard:    { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border, gap: 10 },
  locDot:     { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  locName:    { color: C.text, fontSize: 13, fontWeight: "600" },
  locCat:     { color: C.sub, fontSize: 11, marginTop: 1 },
  locActions: { flexDirection: "row", gap: 6 },

  locBtn:            { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  locBtnActiveGreen: { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.08)" },
  locBtnText:        { color: C.sub, fontSize: 11, fontWeight: "600" },

  goBtn:         { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.green },
  goBtnActive:   { backgroundColor: C.green },
  goBtnText:     { color: C.green, fontSize: 12, fontWeight: "700" },
  goBtnTextActive:{ color: "#0F0F13" },

  emptyText: { color: C.sub, textAlign: "center", paddingTop: 30 },
});
