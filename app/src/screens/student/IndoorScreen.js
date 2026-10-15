/**
 * IndoorScreen.js
 *
 * Indoor mode UI for the Pathfinder screen.
 * Mounted by PathfinderScreen when the Indoor toggle is active.
 *
 * Features:
 *  - Search box → calls searchIndoor()
 *  - Filter chips: All / Offices / Lecturers / Lecture halls / Courses
 *  - Results list using IndoorPlaceCard
 *  - Empty search → Browse view (Buildings → Floors → Rooms)
 *  - Go tap → bottom sheet with 3-step directions + Start outdoor route button
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
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
import { loadIndoorPlaces, getIndoorBuildings, getIndoorFloors, getIndoorRooms } from "../../services/indoor-data";
import { searchIndoor, INDOOR_FILTERS } from "../../services/indoor-search";

// ─── COLOURS ─────────────────────────────────────────────────────────────────
const C = {
  bg:      "#F7F8FA",
  surface: "#FFFFFF",
  border:  "#E2E6ED",
  green:   "#1E7A46",
  text:    "#0F1117",
  sub:     "#6B7280",
  overlay: "rgba(0,0,0,0.45)",
};

// ─── FILTER CHIPS CONFIG ──────────────────────────────────────────────────────
const CHIPS = [
  { label: "All",           value: INDOOR_FILTERS.ALL      },
  { label: "Offices",       value: INDOOR_FILTERS.OFFICE   },
  { label: "Lecturers",     value: INDOOR_FILTERS.LECTURER },
  { label: "Lecture halls", value: INDOOR_FILTERS.HALL     },
  { label: "Courses",       value: INDOOR_FILTERS.COURSE   },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function floorLabel(floor, label) {
  return label ?? (floor === 0 ? "Ground Floor" : `Floor ${floor}`);
}

function formatWalkTime(meters) {
  if (!meters) return "a few min";
  const mins = Math.max(1, Math.round(meters / 80));
  return `about ${mins} min`;
}

// ─── GO DETAIL SHEET ─────────────────────────────────────────────────────────
function GoSheet({ place, onClose, onStartOutdoor }) {
  if (!place) return null;

  const step1 = `Walk to ${place.buildingName} main entrance`;
  const step2 = place.floor === 0
    ? "Head inside — room is on the ground floor"
    : `Go up to the ${place.floorLabel}`;
  const step3 = place.hint
    ? place.hint
    : `Look for "${place.name}"`;

  return (
    <Modal
      visible={!!place}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{place.name}</Text>
          <Text style={styles.sheetSub}>
            {[place.buildingName, place.floorLabel, place.room !== place.name ? place.room : null]
              .filter(Boolean).join(" · ")}
          </Text>
        </View>

        {/* Steps */}
        <View style={styles.steps}>
          {[step1, step2, step3].map((text, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={styles.startBtn}
            onPress={() => onStartOutdoor(place)}
            activeOpacity={0.8}
          >
            <Text style={styles.startBtnText}>Start outdoor route</Text>
          </TouchableOpacity>
          {/* Floor plan hidden — no floorPlan field in JSON yet */}
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

          {openBuilding === b.id && (
            <View style={styles.browseIndent}>
              {getIndoorFloors(b.id).map((f) => (
                <View key={f.floor}>
                  <TouchableOpacity
                    style={styles.browseFloorRow}
                    onPress={() => setOpenFloor(openFloor === `${b.id}_${f.floor}` ? null : `${b.id}_${f.floor}`)}
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
                        <IndoorPlaceCard
                          key={place.id}
                          place={place}
                          onGo={onSelectPlace}
                          compact
                        />
                      ))}
                      {getIndoorRooms(b.id, f.floor).length === 0 && (
                        <Text style={styles.emptyText}>No rooms listed yet.</Text>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────
export default function IndoorScreen({ navigation, onBuildingSelect }) {
  const [search,      setSearch]      = useState("");
  const [filter,      setFilter]      = useState(INDOOR_FILTERS.ALL);
  const [activePlace, setActivePlace] = useState(null);

  // Memoised search results
  const results = useMemo(
    () => searchIndoor(search, filter),
    [search, filter]
  );

  const isSearching = search.trim().length > 0;

  // Go tapped on a card
  const handleGo = useCallback((place) => {
    setActivePlace(place);
  }, []);

  // Start outdoor route — find the building in outdoor locations and navigate
  const handleStartOutdoor = useCallback((place) => {
    setActivePlace(null);
    // Bubble up to PathfinderScreen to set the outdoor destination
    onBuildingSelect?.(place.buildingId, place.buildingName);
  }, [onBuildingSelect]);

  return (
    <View style={styles.root}>
      {/* Search bar */}
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
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipContent}
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

      {/* Go detail sheet */}
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
  root: { flex: 1, backgroundColor: C.bg },

  // Search
  searchBar: {
    flexDirection:     "row",
    alignItems:        "center",
    backgroundColor:   C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingHorizontal: 16,
    paddingVertical:   10,
    gap:               10,
  },
  searchIcon:  { fontSize: 16 },
  searchInput: {
    flex:            1,
    color:           C.text,
    fontSize:        15,
    paddingVertical: Platform.OS === "ios" ? 6 : 2,
  },

  // Chips
  chipRow:     { flexGrow: 0, maxHeight: 52, borderBottomWidth: 1, borderBottomColor: C.border },
  chipContent: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  chip:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipActive:  { borderColor: C.green, backgroundColor: "rgba(30,122,70,0.1)" },
  chipText:    { color: C.sub,   fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: C.green },

  // List
  list:        { flex: 1 },
  listContent: { padding: 16, paddingBottom: 40 },

  // Empty state
  emptyWrap:  { alignItems: "center", paddingTop: 48 },
  emptyTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 6 },
  emptySub:   { color: C.sub, fontSize: 14, textAlign: "center", lineHeight: 20 },
  emptyText:  { color: C.sub, fontSize: 13, paddingVertical: 8, paddingHorizontal: 4 },

  // Browse
  browseHeading:   { color: C.sub, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  browseRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.surface, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  browseRowText:   { color: C.text, fontSize: 15, fontWeight: "600" },
  browseChev:      { color: C.sub, fontSize: 12 },
  browseIndent:    { paddingLeft: 12, marginBottom: 4 },
  browseFloorRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.bg, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: C.border },
  browseFloorText: { color: C.text, fontSize: 14, fontWeight: "600" },
  browseCount:     { color: C.sub, fontWeight: "400" },

  // Go sheet
  sheetOverlay: { flex: 1, backgroundColor: C.overlay },
  sheet: {
    backgroundColor:    C.surface,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    padding:              24,
    paddingBottom:        Platform.OS === "ios" ? 40 : 28,
    gap:                  16,
  },
  sheetHeader: { gap: 4 },
  sheetTitle:  { color: C.text, fontSize: 18, fontWeight: "700" },
  sheetSub:    { color: C.sub,  fontSize: 13 },

  steps: { gap: 12 },
  stepRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           12,
  },
  stepNum: {
    width:          24,
    height:         24,
    borderRadius:   12,
    backgroundColor: C.green,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
    marginTop:      1,
  },
  stepNumText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  stepText:    { color: C.text, fontSize: 14, lineHeight: 22, flex: 1 },

  sheetActions: { flexDirection: "row", gap: 10 },
  startBtn: {
    flex:            1,
    backgroundColor: C.green,
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      "center",
  },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  sheetClose:     { alignItems: "center", paddingTop: 4 },
  sheetCloseText: { color: C.sub, fontSize: 14 },
});
