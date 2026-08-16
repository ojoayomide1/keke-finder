/**
 * PathfinderScreen.js
 *
 * Campus walking-route map for students.
 * Mirrors the map/pathfinder view from the main branch, built for React Native.
 *
 * Layout
 * ──────
 *  ┌──────────────────────────────┐
 *  │  Header                      │
 *  │  MapView (full screen)       │
 *  │    ├─ All campus markers     │
 *  │    └─ Route polyline         │
 *  │  Bottom panel                │
 *  │    ├─ Category filter chips  │
 *  │    ├─ Origin / Dest pickers  │
 *  │    ├─ Route info row         │
 *  │    └─ Location list          │
 *  └──────────────────────────────┘
 *
 * Route drawing
 * ─────────────
 *  Select any two locations → calculateCampusRoute() → draw Polyline on map.
 *  Falls back to a straight dashed line if no admin paths are mapped yet.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
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
  CAMPUS_CATEGORY_META,
} from "../../services/campus-data";
import {
  calculateCampusRoute,
  getDistanceMeters,
} from "../../services/campus-router";

// ─── COLOURS ─────────────────────────────────────────────────────────────────

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  border:    "#2a2a35",
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  text:      "#FFFFFF",
  sub:       "#888",
  orange:    "#f59e0b",
  blue:      "#3b82f6",
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

function formatWalkTime(metres) {
  if (!Number.isFinite(metres)) return "—";
  // Average walking speed ≈ 1.4 m/s (5 km/h)
  const seconds = metres / 1.4;
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "~1 min" : `~${minutes} min`;
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

/** Horizontal scrolling category filter chips */
function CategoryFilters({ active, onChange }) {
  const allOption = { id: "all", label: "All" };
  const categories = [
    allOption,
    ...Object.entries(CAMPUS_CATEGORY_META).map(([id, meta]) => ({
      id,
      label: meta.label,
    })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filtersContent}
      style={styles.filters}
    >
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat.id}
          style={[
            styles.filterChip,
            active === cat.id && styles.filterChipActive,
          ]}
          onPress={() => onChange(cat.id)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.filterChipText,
              active === cat.id && styles.filterChipTextActive,
            ]}
          >
            {cat.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/** A dropdown-style location picker */
function LocationPicker({ label, value, locations, onSelect, accentColor }) {
  const [open, setOpen] = useState(false);
  const selected = locations.find((l) => l.id === value);

  return (
    <View style={styles.pickerWrap}>
      <Text style={[styles.pickerLabel, accentColor && { color: accentColor }]}>
        {label}
      </Text>
      <TouchableOpacity
        style={[
          styles.pickerBtn,
          accentColor && open && { borderColor: accentColor },
        ]}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <Text
          style={[styles.pickerBtnText, !selected && { color: C.sub }]}
          numberOfLines={1}
        >
          {selected ? selected.name : `Select ${label}`}
        </Text>
        <Text style={{ color: C.sub, fontSize: 12 }}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.pickerDropdown}>
          <TouchableOpacity
            style={styles.pickerOption}
            onPress={() => { onSelect(null); setOpen(false); }}
          >
            <Text style={[styles.pickerOptionText, { color: C.sub }]}>
              — Clear —
            </Text>
          </TouchableOpacity>
          {locations.map((loc) => (
            <TouchableOpacity
              key={loc.id}
              style={[
                styles.pickerOption,
                value === loc.id && styles.pickerOptionActive,
              ]}
              onPress={() => { onSelect(loc.id); setOpen(false); }}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  value === loc.id && { color: C.green },
                ]}
                numberOfLines={1}
              >
                {loc.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

/** A single location card in the list */
function LocationCard({ loc, onSetOrigin, onSetDest, isOrigin, isDest }) {
  const meta = getCampusCategoryMeta(loc.category);
  return (
    <View style={styles.locCard}>
      <View style={styles.locCardLeft}>
        <View style={[styles.locDot, { backgroundColor: meta.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.locName} numberOfLines={1}>{loc.name}</Text>
          <Text style={styles.locCategory}>{meta.label}</Text>
        </View>
      </View>
      <View style={styles.locCardActions}>
        <TouchableOpacity
          style={[styles.locAction, isOrigin && styles.locActionActive]}
          onPress={() => onSetOrigin(loc.id)}
          activeOpacity={0.7}
        >
          <Text style={[styles.locActionText, isOrigin && { color: C.green }]}>
            From
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.locAction, isDest && styles.locActionActive]}
          onPress={() => onSetDest(loc.id)}
          activeOpacity={0.7}
        >
          <Text style={[styles.locActionText, isDest && { color: C.green }]}>
            To
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function PathfinderScreen() {
  const mapRef = useRef(null);

  const [locations,    setLocations]    = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Route state
  const [originId, setOriginId]   = useState(null);
  const [destId,   setDestId]     = useState(null);
  const [route,    setRoute]      = useState(null);   // { points, distance, routed, reason }
  const [routing,  setRouting]    = useState(false);

  // Panel expand
  const panelAnim = useRef(new Animated.Value(0)).current;
  const [panelExpanded, setPanelExpanded] = useState(false);

  const unsubCampusRef = useRef(null);

  // ── Load campus data ────────────────────────────────────────────────────
  useEffect(() => {
    loadCampusDataFromFirestore().then(() => {
      setLocations(getCampusLocationsForMap());
    });

    unsubCampusRef.current = listenToCampusData(() => {
      setLocations(getCampusLocationsForMap());
    });

    // User location for the recenter button
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
        });
      }
    })();

    return () => unsubCampusRef.current?.();
  }, []);

  // ── Calculate route whenever origin or dest changes ─────────────────────
  useEffect(() => {
    if (!originId || !destId) {
      setRoute(null);
      return;
    }
    const originLoc = locations.find((l) => l.id === originId);
    const destLoc   = locations.find((l) => l.id === destId);
    if (!originLoc || !destLoc) return;

    setRouting(true);
    // setTimeout keeps the UI from blocking during graph construction
    const id = setTimeout(() => {
      try {
        const result = calculateCampusRoute(
          { lat: originLoc.lat, lng: originLoc.lng },
          { lat: destLoc.lat,   lng: destLoc.lng   }
        );
        setRoute(result);

        // Fit the map to the route bounds
        if (result.points.length >= 2 && mapRef.current) {
          const coords = result.points.map(([lat, lng]) => ({
            latitude:  lat,
            longitude: lng,
          }));
          mapRef.current.fitToCoordinates(coords, {
            edgePadding: { top: 60, right: 40, bottom: 260, left: 40 },
            animated:    true,
          });
        }
      } catch (err) {
        console.warn("[Pathfinder] Route error:", err);
        setRoute({ points: [], distance: null, routed: false, reason: "Routing failed" });
      } finally {
        setRouting(false);
      }
    }, 50);

    return () => clearTimeout(id);
  }, [originId, destId, locations]);

  // ── Panel animation ──────────────────────────────────────────────────────
  function togglePanel() {
    const next = !panelExpanded;
    setPanelExpanded(next);
    Animated.spring(panelAnim, {
      toValue:        next ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }

  const panelHeight = panelAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [220, 480],
  });

  // ── Derived data ─────────────────────────────────────────────────────────
  const filteredLocations = useMemo(
    () =>
      categoryFilter === "all"
        ? locations
        : locations.filter((l) => l.category === categoryFilter),
    [locations, categoryFilter]
  );

  const mapRegion = useMemo(() => {
    const first = locations[0];
    if (first) {
      return {
        latitude:       first.lat,
        longitude:      first.lng,
        latitudeDelta:  0.012,
        longitudeDelta: 0.012,
      };
    }
    return {
      latitude:       6.9,
      longitude:      4.95,
      latitudeDelta:  0.015,
      longitudeDelta: 0.015,
    };
  }, [locations]);

  const routeCoords = useMemo(
    () =>
      route?.points?.map(([lat, lng]) => ({
        latitude:  lat,
        longitude: lng,
      })) ?? [],
    [route]
  );

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* ── HEADER ──────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Pathfinder</Text>
          <Text style={styles.headerSub}>Find your way around campus</Text>
        </View>
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkOp}>OP</Text>
          <Text style={styles.wordmarkRides}>rides</Text>
        </View>
      </View>

      {/* ── MAP ─────────────────────────────────────────────────── */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={mapRegion}
          showsUserLocation
          showsMyLocationButton={false}
        >
          {/* Campus location markers */}
          {locations.map((loc) => {
            const meta     = getCampusCategoryMeta(loc.category);
            const isOrigin = loc.id === originId;
            const isDest   = loc.id === destId;
            return (
              <Marker
                key={loc.id}
                coordinate={{ latitude: loc.lat, longitude: loc.lng }}
                title={loc.name}
                description={meta.label}
                pinColor={isOrigin ? C.green : isDest ? C.orange : meta.color}
              />
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
            onPress={() =>
              mapRef.current?.animateToRegion(
                {
                  latitude:       userLocation.lat,
                  longitude:      userLocation.lng,
                  latitudeDelta:  0.005,
                  longitudeDelta: 0.005,
                },
                600
              )
            }
          >
            <Text style={styles.recenterIcon}>⊕</Text>
          </TouchableOpacity>
        )}

        {/* Route calculating spinner */}
        {routing && (
          <View style={styles.routingBadge}>
            <ActivityIndicator size="small" color={C.green} />
            <Text style={styles.routingText}>Calculating route…</Text>
          </View>
        )}
      </View>

      {/* ── BOTTOM PANEL ────────────────────────────────────────── */}
      <Animated.View style={[styles.panel, { height: panelHeight }]}>
        {/* Drag handle */}
        <TouchableOpacity
          style={styles.handleWrap}
          onPress={togglePanel}
          activeOpacity={1}
        >
          <View style={styles.handle} />
        </TouchableOpacity>

        {/* Category filters */}
        <CategoryFilters active={categoryFilter} onChange={setCategoryFilter} />

        {/* Route pickers */}
        <View style={styles.routeRow}>
          <View style={{ flex: 1 }}>
            <LocationPicker
              label="From"
              value={originId}
              locations={filteredLocations}
              onSelect={setOriginId}
              accentColor={C.green}
            />
          </View>
          <TouchableOpacity
            style={styles.swapBtn}
            onPress={() => {
              setOriginId(destId);
              setDestId(originId);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.swapIcon}>⇄</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <LocationPicker
              label="To"
              value={destId}
              locations={filteredLocations}
              onSelect={setDestId}
              accentColor={C.orange}
            />
          </View>
        </View>

        {/* Route info row */}
        {route && (
          <View style={styles.routeInfo}>
            <View style={styles.routeInfoItem}>
              <Text style={styles.routeInfoLabel}>Distance</Text>
              <Text style={styles.routeInfoValue}>
                {formatDistance(route.distance)}
              </Text>
            </View>
            <View style={styles.routeInfoDivider} />
            <View style={styles.routeInfoItem}>
              <Text style={styles.routeInfoLabel}>Walk time</Text>
              <Text style={styles.routeInfoValue}>
                {formatWalkTime(route.distance)}
              </Text>
            </View>
            <View style={styles.routeInfoDivider} />
            <View style={styles.routeInfoItem}>
              <Text style={styles.routeInfoLabel}>Type</Text>
              <Text
                style={[
                  styles.routeInfoValue,
                  { color: route.routed ? C.green : C.orange },
                ]}
              >
                {route.routed ? "Path route" : "Straight line"}
              </Text>
            </View>
          </View>
        )}

        {/* Location list — only visible when panel is expanded */}
        {panelExpanded && (
          <FlatList
            data={filteredLocations}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.locList}
            nestedScrollEnabled
            renderItem={({ item }) => (
              <LocationCard
                loc={item}
                onSetOrigin={(id) => { setOriginId(id); togglePanel(); }}
                onSetDest={(id)   => { setDestId(id);   togglePanel(); }}
                isOrigin={item.id === originId}
                isDest={item.id === destId}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {locations.length === 0
                  ? "No campus locations mapped yet."
                  : "No locations in this category."}
              </Text>
            }
          />
        )}
      </Animated.View>
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // ── Header
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 20,
    paddingTop:        Platform.OS === "ios" ? 56 : 44,
    paddingBottom:     12,
    backgroundColor:   C.bg,
    zIndex:            10,
  },
  headerTitle:   { color: C.text, fontWeight: "800", fontSize: 20 },
  headerSub:     { color: C.sub, fontSize: 12, marginTop: 1 },
  wordmark:      { flexDirection: "row" },
  wordmarkOp:    { color: C.text, fontWeight: "800", fontSize: 20 },
  wordmarkRides: { color: C.green, fontWeight: "800", fontSize: 20 },

  // ── Map
  mapContainer: { flex: 1 },
  recenterBtn: {
    position:        "absolute",
    bottom:          12,
    right:           12,
    backgroundColor: C.surface,
    width:           40,
    height:          40,
    borderRadius:    20,
    alignItems:      "center",
    justifyContent:  "center",
    borderWidth:     1,
    borderColor:     C.border,
  },
  recenterIcon: { color: C.green, fontSize: 22, lineHeight: 26 },

  routingBadge: {
    position:        "absolute",
    top:             12,
    alignSelf:       "center",
    flexDirection:   "row",
    alignItems:      "center",
    gap:             8,
    backgroundColor: C.surface,
    borderRadius:    20,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth:     1,
    borderColor:     C.border,
  },
  routingText: { color: C.sub, fontSize: 12 },

  // ── Bottom panel
  panel: {
    backgroundColor:      C.surface,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    borderTopWidth:       1,
    borderColor:          C.border,
    overflow:             "hidden",
  },
  handleWrap: { alignItems: "center", paddingVertical: 10 },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },

  // ── Category filters
  filters:        { maxHeight: 44, marginBottom: 4 },
  filtersContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  filterChip:     { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg },
  filterChipActive:     { backgroundColor: C.greenMute, borderColor: C.green },
  filterChipText:       { color: C.sub, fontSize: 12, fontWeight: "600" },
  filterChipTextActive: { color: C.green },

  // ── Route pickers row
  routeRow: {
    flexDirection:     "row",
    alignItems:        "flex-end",
    gap:               6,
    paddingHorizontal: 12,
    marginBottom:      4,
  },
  swapBtn:  { paddingBottom: 10, paddingHorizontal: 4 },
  swapIcon: { color: C.sub, fontSize: 20 },

  pickerWrap:  { marginBottom: 6 },
  pickerLabel: { color: C.sub, fontSize: 10, marginBottom: 3, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  pickerBtn: {
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "center",
    backgroundColor:   C.bg,
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       C.border,
    paddingHorizontal: 10,
    paddingVertical:   9,
  },
  pickerBtnText:      { color: C.text, fontSize: 12, flex: 1 },
  pickerDropdown:     { backgroundColor: C.bg, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginTop: 3, maxHeight: 180, overflow: "hidden" },
  pickerOption:       { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerOptionActive: { backgroundColor: C.greenMute },
  pickerOptionText:   { color: C.text, fontSize: 12 },

  // ── Route info
  routeInfo: {
    flexDirection:     "row",
    alignItems:        "center",
    backgroundColor:   C.bg,
    borderRadius:      12,
    marginHorizontal:  12,
    marginBottom:      8,
    paddingVertical:   10,
    borderWidth:       1,
    borderColor:       C.border,
  },
  routeInfoItem:    { flex: 1, alignItems: "center" },
  routeInfoLabel:   { color: C.sub, fontSize: 10, marginBottom: 3 },
  routeInfoValue:   { color: C.text, fontWeight: "700", fontSize: 13 },
  routeInfoDivider: { width: 1, height: 30, backgroundColor: C.border },

  // ── Location list
  locList: { paddingHorizontal: 12, paddingBottom: 20 },
  locCard: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "space-between",
    backgroundColor: C.bg,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     C.border,
    padding:         10,
    marginBottom:    8,
  },
  locCardLeft:    { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  locDot:         { width: 10, height: 10, borderRadius: 5 },
  locName:        { color: C.text, fontSize: 13, fontWeight: "600" },
  locCategory:    { color: C.sub, fontSize: 11 },
  locCardActions: { flexDirection: "row", gap: 6 },
  locAction:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  locActionActive:{ backgroundColor: C.greenMute, borderColor: C.green },
  locActionText:  { color: C.sub, fontSize: 12, fontWeight: "600" },

  emptyText: { color: C.sub, textAlign: "center", paddingTop: 20, fontSize: 13 },
});
