/**
 * IndoorScreen.js — Indoor Pathfinder mode
 * Loads place data from Firestore (indoorPlaces/main) at mount time.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import IndoorPlaceCard from "../../components/IndoorPlaceCard";
import {
  fetchIndoorPlaces,
  getIndoorBuildings,
  getIndoorFloors,
  getIndoorRooms,
} from "../../services/indoor-data";
import { searchIndoor, INDOOR_FILTERS } from "../../services/indoor-search";

const C = {
  bg:      "#F7F8FA",
  surface: "#FFFFFF",
  border:  "#E2E6ED",
  green:   "#1E7A46",
  text:    "#0F1117",
  sub:     "#6B7280",
  overlay: "rgba(0,0,0,0.45)",
};

const CHIPS = [
  { label: "All",           value: INDOOR_FILTERS.ALL      },
  { label: "Offices",       value: INDOOR_FILTERS.OFFICE   },
  { label: "Lecturers",     value: INDOOR_FILTERS.LECTURER },
  { label: "Lecture halls", value: INDOOR_FILTERS.HALL     },
  { label: "Courses",       value: INDOOR_FILTERS.COURSE   },
];

// ─── GO DETAIL SHEET ─────────────────────────────────────────────────────────
function GoSheet({ place, onClose, onStartOutdoor }) {
  if (!place) return null;

  // Build steps: prefer custom steps from data, fall back to auto-generated
  let steps;
  if (place.steps && place.steps.length > 0) {
    steps = place.steps;
  } else {
    const s1 = place.entrance
      ? `Walk to ${place.entrance}`
      : `Walk to ${place.buildingName} main entrance`;
    const s2 = place.floor === 0
      ? "Head inside — room is on the ground floor"
      : `Go up to the ${place.floorLabel}`;
    const s3 = place.hint ?? `Look for "${place.name}"`;
    steps = [s1, s2, s3];
  }

  return (
    <Modal
      visible={!!place}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{place.name}</Text>
          <Text style={styles.sheetSub}>
            {[place.buildingName, place.floorLabel,
              place.room !== place.name ? place.room : null]
              .filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View style={styles.steps}>
          {steps.map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={[styles.startBtn, place.floorPlan && { flex: 1 }]}
            onPress={() => onStartOutdoor(place)}
            activeOpacity={0.8}
          >
            <Text style={styles.startBtnText}>Start outdoor route</Text>
          </TouchableOpacity>
          {place.floorPlan ? (
            <TouchableOpacity
              style={styles.floorPlanBtn}
              onPress={() => Linking.openURL(place.floorPlan)}
              activeOpacity={0.8}
            >
              <Text style={styles.floorPlanBtnText}>Floor plan</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
          <Text style={styles.sheetCloseText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── BROWSE VIEW ─────────────────────────────────────────────────────────────
function BrowseView({ onSelectPlace }) {
  const [openBuilding, setOpenBuilding] = useState(null);
  const [openFloor,    setOpenFloor]    = useState(null);
  const buildings = useMemo(() => getIndoorBuildings(), []);

  if (!buildings.length) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No indoor data yet</Text>
        <Text style={styles.emptySub}>Buildings will appear here once added via the admin panel.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <Text style={styles.browseHeading}>Browse by building</Text>
      {buildings.map((b) => (
        <View key={b.id}>
          <TouchableOpacity
            style={styles.browseRow}
            onPress={() => {
              setOpenBuilding(openBuilding === b.id ? null : b.id);
              setOpenFloor(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.browseRowText}>🏛️  {b.name}</Text>
            <Text style={styles.browseChev}>{openBuilding === b.id ? "▲" : "▼"}</Text>
          </TouchableOpacity>

          {openBuilding === b.id && getIndoorFloors(b.id).map((f) => (
            <View key={f.floor} style={styles.browseIndent}>
              <TouchableOpacity
                style={styles.browseFloorRow}
                onPress={() => setOpenFloor(
                  openFloor === `${b.id}_${f.floor}` ? null : `${b.id}_${f.floor}`
                )}
                activeOpacity={0.7}
              >
                <Text style={styles.browseFloorText}>
                  {f.label}
                  <Text style={styles.browseCount}> ({f.roomCount} rooms)</Text>
                </Text>
                <Text style={styles.browseChev}>
                  {openFloor === `${b.id}_${f.floor}` ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>

              {openFloor === `${b.id}_${f.floor}` && (
                <View style={styles.browseIndent}>
                  {getIndoorRooms(b.id, f.floor).map((place) => (
                    <IndoorPlaceCard key={place.id} place={place} onGo={onSelectPlace} compact />
                  ))}
                  {getIndoorRooms(b.id, f.floor).length === 0 && (
                    <Text style={styles.emptyText}>No rooms on this floor yet.</Text>
                  )}
                </View>
              )}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────
export default function IndoorScreen({ navigation, onBuildingSelect }) {
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState(INDOOR_FILTERS.ALL);
  const [activePlace, setActivePlace] = useState(null);
  // tick forces re-render after fetch completes
  const [tick,        setTick]        = useState(0);

  useEffect(() => {
    fetchIndoorPlaces().then(() => {
      setLoading(false);
      setTick(t => t + 1);
    });
  }, []);

  const results = useMemo(
    () => searchIndoor(search, filter),
    [search, filter, tick]  // tick ensures results refresh after fetch
  );

  const isSearching = search.trim().length > 0;

  const handleGo = useCallback((place) => setActivePlace(place), []);

  const handleStartOutdoor = useCallback((place) => {
    setActivePlace(null);
    onBuildingSelect?.(place.buildingId, place.buildingName);
  }, [onBuildingSelect]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={C.green} />
        <Text style={styles.loadingText}>Loading indoor map…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Search */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search rooms, lecturers, courses…"
          placeholderTextColor={C.sub}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch("")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ color: C.sub, fontSize: 16, paddingHorizontal: 4 }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.chipRow} contentContainerStyle={styles.chipContent}
      >
        {CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip.value}
            style={[styles.chip, filter === chip.value && styles.chipActive]}
            onPress={() => setFilter(chip.value)}
          >
            <Text style={[styles.chipText, filter === chip.value && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Results or Browse */}
      {isSearching ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {results.length > 0
            ? results.map((place) => (
                <IndoorPlaceCard key={place.id} place={place} onGo={handleGo} />
              ))
            : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No match found</Text>
                <Text style={styles.emptySub}>
                  Try a lecturer's name, a room number, or a course code.
                </Text>
              </View>
            )
          }
        </ScrollView>
      ) : (
        <BrowseView onSelectPlace={handleGo} />
      )}

      <GoSheet
        place={activePlace}
        onClose={() => setActivePlace(null)}
        onStartOutdoor={handleStartOutdoor}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.bg },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: C.sub, fontSize: 14 },

  searchBar: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
    paddingHorizontal: 16, paddingVertical: 10, gap: 10,
  },
  searchIcon:  { fontSize: 16 },
  searchInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: Platform.OS === "ios" ? 6 : 2 },

  chipRow:        { flexGrow: 0, maxHeight: 52, borderBottomWidth: 1, borderBottomColor: C.border },
  chipContent:    { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipActive:     { borderColor: C.green, backgroundColor: "rgba(30,122,70,0.1)" },
  chipText:       { color: C.sub,   fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: C.green },

  list:        { flex: 1 },
  listContent: { padding: 16, paddingBottom: 40 },

  emptyWrap:  { alignItems: "center", paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  emptySub:   { color: C.sub, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyText:  { color: C.sub, fontSize: 13, paddingVertical: 8 },

  browseHeading:   { color: C.sub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  browseRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.surface, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  browseRowText:   { color: C.text, fontSize: 15, fontWeight: "600" },
  browseChev:      { color: C.sub, fontSize: 12 },
  browseIndent:    { paddingLeft: 12, marginBottom: 4 },
  browseFloorRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.bg, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: C.border },
  browseFloorText: { color: C.text, fontSize: 14, fontWeight: "600" },
  browseCount:     { color: C.sub, fontWeight: "400" },

  sheetOverlay: { flex: 1, backgroundColor: C.overlay },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: Platform.OS === "ios" ? 40 : 28, gap: 16,
  },
  sheetHeader: { gap: 4 },
  sheetTitle:  { color: C.text, fontSize: 18, fontWeight: "700" },
  sheetSub:    { color: C.sub, fontSize: 13 },

  steps:       { gap: 12 },
  stepRow:     { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepNum:     { width: 24, height: 24, borderRadius: 12, backgroundColor: C.green, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  stepNumText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  stepText:    { color: C.text, fontSize: 14, lineHeight: 22, flex: 1 },

  sheetActions:    { flexDirection: "row", gap: 10 },
  startBtn:        { flex: 1, backgroundColor: C.green, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  startBtnText:    { color: "#fff", fontWeight: "700", fontSize: 15 },
  floorPlanBtn:    { backgroundColor: C.surface, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", borderWidth: 1, borderColor: C.border },
  floorPlanBtnText:{ color: C.text, fontWeight: "700", fontSize: 14 },

  sheetClose:     { alignItems: "center", paddingTop: 4 },
  sheetCloseText: { color: C.sub, fontSize: 14 },
});
