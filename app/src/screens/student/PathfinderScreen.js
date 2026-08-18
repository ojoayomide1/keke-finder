/**
 * PathfinderScreen.js — Campus walking route finder (full page)
 *
 * Select From + To → calculates walking route → View on Map
 * "View on Map" sets walk route in store and switches to Map tab
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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

  const unsubCampusRef = useRef(null);

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

    return () => unsubCampusRef.current?.();
  }, []);

  // ── Calculate route ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!destId) { setRoute(null); return; }

    const originLoc = originId === null
      ? (userLocation ? { ...userLocation, id: "_current", name: "Current Location" } : null)
      : locations.find(l => l.id === originId);

    const destLoc = locations.find(l => l.id === destId);
    if (!originLoc || !destLoc) return;

    setRouting(true);
    const id = setTimeout(() => {
      try {
        const result = calculateCampusRoute(originLoc, destLoc);
        setRoute({ ...result, originName: originLoc.name, destName: destLoc.name });
      } catch {
        setRoute({ points: [], distance: null, routed: false, originName: originLoc.name, destName: destLoc.name });
      } finally {
        setRouting(false);
      }
    }, 50);

    return () => clearTimeout(id);
  }, [originId, destId, locations, userLocation]);

  // ── View on Map ─────────────────────────────────────────────────────────
  function handleViewOnMap() {
    if (!route) return;
    setWalkOriginId(originId);
    setWalkRoute(route);
    navigation.navigate("Map");
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const filteredLocations = useMemo(() =>
    filter === "all" ? locations : locations.filter(l => l.category === filter),
    [locations, filter]
  );

  const originName = originId === null
    ? "Current Location"
    : locations.find(l => l.id === originId)?.name ?? "Select origin";

  const destName = locations.find(l => l.id === destId)?.name ?? null;

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Pathfinder</Text>
        <Text style={styles.headerSub}>Find your way around campus</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* ── Route pickers ───────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>From</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, originId === null && styles.chipActive]}
              onPress={() => setOriginId(null)}
            >
              <Text style={[styles.chipText, originId === null && styles.chipTextActive]}>
                Current Location
              </Text>
            </TouchableOpacity>
            {locations.map(loc => (
              <TouchableOpacity
                key={loc.id}
                style={[styles.chip, originId === loc.id && styles.chipActive]}
                onPress={() => setOriginId(loc.id)}
              >
                <Text style={[styles.chipText, originId === loc.id && styles.chipTextActive]}>
                  {CATEGORY_EMOJI[loc.category] ?? "📍"} {loc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.divider} />

          <Text style={styles.cardLabel}>To</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {locations.map(loc => (
              <TouchableOpacity
                key={loc.id}
                style={[styles.chip, styles.destChip, destId === loc.id && styles.destChipActive]}
                onPress={() => setDestId(loc.id)}
              >
                <Text style={[styles.chipText, destId === loc.id && styles.destChipTextActive]}>
                  {CATEGORY_EMOJI[loc.category] ?? "📍"} {loc.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Swap button */}
          {originId !== null && destId && (
            <TouchableOpacity
              style={styles.swapBtn}
              onPress={() => { const tmp = originId; setOriginId(destId); setDestId(tmp); }}
            >
              <Text style={styles.swapBtnText}>Swap</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Route result ────────────────────────────────────────── */}
        {routing && (
          <View style={styles.card}>
            <ActivityIndicator color={C.green} />
            <Text style={[styles.cardLabel, { marginTop: 8 }]}>Calculating route...</Text>
          </View>
        )}

        {route && !routing && (
          <View style={styles.card}>
            <Text style={styles.routeTitle}>
              {originName} → {destName}
            </Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatDistance(route.distance)}</Text>
                <Text style={styles.statLabel}>Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatWalkTime(route.distance)}</Text>
                <Text style={styles.statLabel}>Walk time</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: route.routed ? C.green : C.orange }]}>
                  {route.routed ? "Mapped" : "Straight"}
                </Text>
                <Text style={styles.statLabel}>Route type</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.viewMapBtn} onPress={handleViewOnMap}>
              <Text style={styles.viewMapBtnText}>View on Map</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Category filter ─────────────────────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
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
        {filteredLocations.map(loc => {
          const meta     = getCampusCategoryMeta(loc.category);
          const isOrigin = loc.id === originId;
          const isDest   = loc.id === destId;
          return (
            <View key={loc.id} style={styles.locCard}>
              <View style={[styles.locDot, { backgroundColor: meta.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.locName}>{loc.name}</Text>
                <Text style={styles.locCat}>{meta.label}</Text>
              </View>
              <View style={styles.locActions}>
                <TouchableOpacity
                  style={[styles.locBtn, isOrigin && styles.locBtnActiveGreen]}
                  onPress={() => setOriginId(loc.id)}
                >
                  <Text style={[styles.locBtnText, isOrigin && { color: C.green }]}>From</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locBtn, isDest && styles.locBtnActiveOrange]}
                  onPress={() => setDestId(loc.id)}
                >
                  <Text style={[styles.locBtnText, isDest && { color: C.orange }]}>To</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

      </ScrollView>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  header: {
    paddingHorizontal: 20,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: "700" },
  headerSub:   { color: C.sub, fontSize: 13, marginTop: 2 },

  card: {
    backgroundColor: C.surface,
    borderRadius:    16,
    padding:         16,
    marginBottom:    16,
    borderWidth:     1,
    borderColor:     C.border,
  },
  cardLabel: { color: C.sub, fontSize: 12, fontWeight: "600", marginBottom: 8, textTransform: "uppercase" },

  chipRow: { flexGrow: 0, marginBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:      20,
    backgroundColor:   C.bg,
    borderWidth:       1,
    borderColor:       C.border,
    marginRight:       8,
  },
  chipActive:     { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.1)" },
  chipText:       { color: C.sub, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: C.green },

  destChip:          { },
  destChipActive:    { borderColor: C.orange, backgroundColor: "rgba(255,94,26,0.1)" },
  destChipTextActive:{ color: C.orange },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },

  swapBtn:     { alignSelf: "flex-start", marginTop: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  swapBtnText: { color: C.sub, fontSize: 12 },

  routeTitle: { color: C.text, fontSize: 15, fontWeight: "600", marginBottom: 12 },

  statsRow:    { flexDirection: "row", backgroundColor: C.bg, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  statItem:    { flex: 1, alignItems: "center" },
  statValue:   { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 2 },
  statLabel:   { color: C.sub, fontSize: 11 },
  statDivider: { width: 1, backgroundColor: C.border, marginHorizontal: 8 },

  viewMapBtn:     { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  viewMapBtnText: { color: "#0F0F13", fontWeight: "700", fontSize: 15 },

  filterRow: { flexGrow: 0, marginBottom: 12 },
  filterChip:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, marginRight: 8 },
  filterChipActive:    { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.1)" },
  filterChipText:      { color: C.sub, fontSize: 12, fontWeight: "600" },
  filterChipTextActive:{ color: C.green },

  locCard:    { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border, gap: 10 },
  locDot:     { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  locName:    { color: C.text, fontSize: 13, fontWeight: "600" },
  locCat:     { color: C.sub, fontSize: 11, marginTop: 1 },
  locActions: { flexDirection: "row", gap: 6 },
  locBtn:             { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  locBtnActiveGreen:  { borderColor: C.green, backgroundColor: "rgba(0,196,140,0.08)" },
  locBtnActiveOrange: { borderColor: C.orange, backgroundColor: "rgba(255,94,26,0.08)" },
  locBtnText:         { color: C.sub, fontSize: 12, fontWeight: "600" },
});
