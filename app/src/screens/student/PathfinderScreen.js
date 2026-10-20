/**
 * PathfinderScreen.js — Explore tab (Phase 3 redesign)
 *
 * Replaces the old list-of-rows UI with:
 *   - "Where to?" search bar (sparkles icon, mic if available)
 *   - "From: My location" pill
 *   - Category chips (horizontal scroll)
 *   - Recents (last 3, AsyncStorage)
 *   - Browse grid (2-column category tiles)
 *   - Category list view
 *   - Place sheet (bottom sheet on tap)
 *   → Navigate wires into Map tab via existing routing logic
 *
 * No map inside Explore. Maps live only on the Map tab.
 * Indoor places are included via the unified places.js data layer.
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ActivityIndicator, Animated, FlatList, Modal,
  Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import useStore from "../../store";
import { calculateCampusRoute } from "../../services/campus-router";
import { loadPlaces, getPlaces, getCategoryMeta, CATEGORY_META } from "../../services/places";
import { search, looksLikeQuestion } from "../../services/search";
import { isNavBotAvailable } from "../../services/navbot";
import Icon from "../../components/Icon";
import NavBot from "../../components/NavBot";
import { SkeletonRow, SkeletonCard } from "../../components/Skeleton";
import { C as TC, S, R } from "../../theme/tokens";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const C = {
  bg:      TC.bg,
  surface: TC.surface,
  surface2:TC.surface2,
  border:  TC.border,
  brand:   TC.brand,
  brandSoft: TC.brandSoft,
  text:    TC.text,
  text2:   TC.text2,
  text3:   TC.text3,
  danger:  TC.danger,
};

const RECENTS_KEY = "navcamp_recents_v1";
const MAX_RECENTS = 3;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatDist(m) {
  if (!m && m !== 0) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
function formatWalk(m) {
  if (!m && m !== 0) return null;
  const mins = Math.max(1, Math.round(m / 80));
  return `${mins} min walk`;
}
function placeSubtitle(place) {
  if (place.scope === "indoor") {
    return [place.buildingName, place.floorLabel, place.room !== place.name ? place.room : null]
      .filter(Boolean).join(" · ");
  }
  const meta = getCategoryMeta(place.category);
  return meta.label;
}

// ─── RECENTS STORAGE ──────────────────────────────────────────────────────────
async function loadRecents() {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveRecent(place) {
  try {
    const current = await loadRecents();
    const filtered = current.filter(r => r.id !== place.id);
    const updated = [{ id: place.id, name: place.name, category: place.category, scope: place.scope, buildingName: place.buildingName }, ...filtered].slice(0, MAX_RECENTS);
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
  } catch {}
}

// ─── PLACE ROW ────────────────────────────────────────────────────────────────
function PlaceRow({ place, subtitle, onPress, distance }) {
  const meta = getCategoryMeta(place.category);
  return (
    <Pressable
      style={({ pressed }) => [styles.placeRow, pressed && styles.placeRowPressed]}
      onPress={() => onPress(place)}
      android_ripple={{ color: C.brandSoft }}
    >
      <View style={[styles.placeRowIcon, { backgroundColor: meta.color + "18" }]}>
        <Icon name={meta.icon} size={18} color={meta.color} />
      </View>
      <View style={styles.placeRowText}>
        <Text style={styles.placeRowName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.placeRowSub} numberOfLines={1}>
          {subtitle ?? placeSubtitle(place)}
          {distance ? `  ·  ${distance}` : ""}
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={C.text3} />
    </Pressable>
  );
}

// ─── PLACE SHEET ─────────────────────────────────────────────────────────────
function PlaceSheet({ place, userLocation, fromPlace, onClose, onNavigate, onSetFrom }) {
  if (!place) return null;

  const meta = getCategoryMeta(place.category);
  const subtitle = placeSubtitle(place);

  // Calculate walk time from current from-point
  const walkInfo = useMemo(() => {
    if (!userLocation && !fromPlace) return null;
    const origin = fromPlace
      ? { lat: fromPlace.coords?.lat, lng: fromPlace.coords?.lng }
      : userLocation;
    if (!origin?.lat || !place.coords) return null;
    try {
      const result = calculateCampusRoute(origin, place.coords);
      return result?.distance ? { dist: formatDist(result.distance), time: formatWalk(result.distance) } : null;
    } catch { return null; }
  }, [place, userLocation, fromPlace]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.sheetHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <View style={[styles.sheetIcon, { backgroundColor: meta.color + "18" }]}>
            <Icon name={meta.icon} size={24} color={meta.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sheetName}>{place.name}</Text>
            <Text style={styles.sheetSub}>{subtitle}</Text>
            {place.people?.length > 0 && (
              <Text style={styles.sheetPeople}>
                {place.people[0].role ? `${place.people[0].role}: ` : ""}{place.people[0].name}
              </Text>
            )}
          </View>
        </View>

        {/* Walk info */}
        {walkInfo && (
          <View style={styles.sheetWalkInfo}>
            <Icon name="footprints" size={14} color={C.brand} />
            <Text style={styles.sheetWalkText}>{walkInfo.time} · {walkInfo.dist}</Text>
          </View>
        )}

        {/* Courses */}
        {place.courses?.length > 0 && (
          <View style={styles.sheetCourses}>
            {place.courses.slice(0, 3).map(c => (
              <View key={c.code} style={styles.sheetCourseChip}>
                <Text style={styles.sheetCourseText}>{c.code}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.sheetActions}>
          <TouchableOpacity style={styles.navigateBtn} onPress={() => onNavigate(place)} activeOpacity={0.8}>
            <Icon name="navigation" size={18} color="#fff" />
            <Text style={styles.navigateBtnText}>Navigate</Text>
          </TouchableOpacity>
          {place.floorPlanUrl && (
            <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.8}>
              <Text style={styles.secondaryBtnText}>Floor plan</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Set as starting point */}
        <TouchableOpacity style={styles.sheetTertiary} onPress={() => { onSetFrom(place); onClose(); }}>
          <Text style={styles.sheetTertiaryText}>Set as starting point</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── FROM PICKER ─────────────────────────────────────────────────────────────
function FromPicker({ visible, onClose, onSelect }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => q.trim() ? search(q, { scope: "outdoor" }) : getPlaces().filter(p => p.scope === "outdoor").slice(0, 20), [q]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.pickerOverlay}>
        <View style={styles.picker}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Choose starting point</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="x" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.pickerMyLocation} onPress={() => onSelect(null)}>
            <Icon name="map-pin" size={18} color={C.brand} />
            <Text style={styles.pickerMyLocationText}>My current location</Text>
          </TouchableOpacity>
          <View style={styles.pickerSearchBar}>
            <Icon name="search" size={16} color={C.text3} />
            <TextInput
              style={styles.pickerInput}
              placeholder="Search a place..."
              placeholderTextColor={C.text3}
              value={q}
              onChangeText={setQ}
              autoFocus
            />
          </View>
          <FlatList
            data={results}
            keyExtractor={p => p.id}
            renderItem={({ item }) => (
              <PlaceRow place={item} onPress={(p) => { onSelect(p); onClose(); }} />
            )}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 300 }}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── CATEGORY LIST ────────────────────────────────────────────────────────────
function CategoryList({ category, onBack, onSelectPlace }) {
  const places = useMemo(() => getPlaces().filter(p => p.category === category), [category]);
  const meta   = getCategoryMeta(category);

  // Group hostels by subCategory
  const groups = useMemo(() => {
    if (!["boys_hostel", "girls_hostel"].includes(category)) return null;
    const map = {};
    places.forEach(p => {
      const key = p.subCategory ?? meta.label;
      map[key] = map[key] ?? [];
      map[key].push(p);
    });
    return Object.entries(map);
  }, [places, category]);

  return (
    <View style={styles.root}>
      <View style={styles.catListHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.catListTitle}>{meta.label}</Text>
        <Text style={styles.catListCount}>{places.length}</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {groups ? groups.map(([group, items]) => (
          <View key={group}>
            <Text style={styles.stickyHeader}>{group}</Text>
            {items.map(p => <PlaceRow key={p.id} place={p} onPress={onSelectPlace} />)}
          </View>
        )) : places.map(p => (
          <PlaceRow key={p.id} place={p} onPress={onSelectPlace} />
        ))}
        {places.length === 0 && (
          <View style={styles.emptyState}>
            <Icon name="map-pin" size={32} color={C.text3} />
            <Text style={styles.emptyTitle}>No places here yet</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────
export default function PathfinderScreen({ navigation }) {
  const { setWalkRoute, setWalkOriginId, clearWalkRoute } = useStore();

  const [ready,        setReady]        = useState(false);
  const [query,        setQuery]        = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [fromPlace,    setFromPlace]    = useState(null); // null = current location
  const [recents,      setRecents]      = useState([]);
  const [activePlace,  setActivePlace]  = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showNavBot,   setShowNavBot]   = useState(false);
  const [navBotQuery,  setNavBotQuery]  = useState("");
  const searchRef = useRef(null);

  // Load data + location on mount
  useEffect(() => {
    Promise.all([
      loadPlaces(),
      loadRecents().then(setRecents),
      Location.requestForegroundPermissionsAsync().then(({ status }) => {
        if (status === "granted") {
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then(loc => setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude }))
            .catch(() => {});
        }
      }),
    ]).then(() => setReady(true));
  }, []);

  // Search results (live as user types)
  const results = useMemo(() => {
    if (!ready) return [];
    const q = query.trim();
    if (!q) return [];
    return search(q);
  }, [query, ready]);

  const isSearching = query.trim().length > 0;

  // Category browse data
  const categories = useMemo(() => {
    if (!ready) return [];
    const places = getPlaces();
    const counts = {};
    places.forEach(p => { counts[p.category] = (counts[p.category] ?? 0) + 1; });
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, count, meta: getCategoryMeta(category) }));
  }, [ready]);

  // Chip categories (top 6 most populated)
  const chipCategories = useMemo(() => categories.slice(0, 6), [categories]);

  const handleSelectPlace = useCallback(async (place) => {
    await saveRecent(place);
    setRecents(await loadRecents());
    setActivePlace(place);
  }, []);

  const handleNavigate = useCallback((place) => {
    setActivePlace(null);

    const origin = fromPlace?.coords ?? userLocation;
    const dest   = place.coords ?? null;

    if (!origin || !dest) {
      // No coordinates — just switch to map
      navigation.navigate("Map");
      return;
    }

    try {
      const route = calculateCampusRoute(origin, dest);
      setWalkOriginId(fromPlace?.id ?? null);
      setWalkRoute({ ...route, originName: fromPlace?.name ?? "My location", destName: place.name });
    } catch {
      clearWalkRoute();
    }
    navigation.navigate("Map");
  }, [fromPlace, userLocation, navigation]);

  const fromLabel = fromPlace ? fromPlace.name : "My location";

  // ─── Category list view ───────────────────────────────────────────────────
  if (activeCategory) {
    return (
      <>
        <CategoryList
          category={activeCategory}
          onBack={() => setActiveCategory(null)}
          onSelectPlace={(p) => { setActiveCategory(null); handleSelectPlace(p); }}
        />
        <PlaceSheet
          place={activePlace}
          userLocation={userLocation}
          fromPlace={fromPlace}
          onClose={() => setActivePlace(null)}
          onNavigate={handleNavigate}
          onSetFrom={setFromPlace}
        />
      </>
    );
  }

  return (
    <View style={styles.root}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Explore</Text>
        <Text style={styles.headerTitle}>Where to?</Text>
      </View>

      {/* ── Search bar ────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Icon name="sparkles" size={18} color={C.brand} />
          <TextInput
            ref={searchRef}
            style={styles.searchInput}
            placeholder="Search or ask, e.g. Dean's office"
            placeholderTextColor={C.text3}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
            >
              <Icon name="x" size={16} color={C.text3} />
            </TouchableOpacity>
          )}
          {looksLikeQuestion(query) && isNavBotAvailable() && (
            <TouchableOpacity
              onPress={() => { setNavBotQuery(query); setShowNavBot(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Ask NavBot AI"
            >
              <Icon name="sparkles" size={16} color={C.brand} />
            </TouchableOpacity>
          )}
        </View>

        {/* From pill */}
        <TouchableOpacity style={styles.fromPill} onPress={() => setShowFromPicker(true)} activeOpacity={0.7}>
          <Icon name="map-pin" size={13} color={C.brand} />
          <Text style={styles.fromPillText} numberOfLines={1}>From: {fromLabel}</Text>
          <Icon name="chevron-right" size={13} color={C.text3} />
        </TouchableOpacity>
      </View>

      {/* ── Search results ────────────────────────────────────────── */}
      {isSearching ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          {results.length > 0
            ? results.map(p => <PlaceRow key={p.id} place={p} onPress={handleSelectPlace} />)
            : (
              <View style={styles.emptyState}>
                <Icon name="search" size={32} color={C.text3} />
                <Text style={styles.emptyTitle}>No match found</Text>
                <Text style={styles.emptySub}>Try a lecturer's name, a course code, or a room number.</Text>
                {looksLikeQuestion(query) && (
                  <TouchableOpacity style={styles.navBotBtn} onPress={() => { setNavBotQuery(query); setShowNavBot(true); }}>
                    <Icon name="sparkles" size={14} color={C.brand} />
                    <Text style={styles.navBotBtnText}>Ask NavBot</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          }
        </ScrollView>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>

          {/* ── Category chips ───────────────────────────────── */}
          {chipCategories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chipsContent}>
              {chipCategories.map(({ category, meta }) => (
                <TouchableOpacity
                  key={category}
                  style={styles.chip}
                  onPress={() => setActiveCategory(category)}
                  activeOpacity={0.75}
                >
                  <Icon name={meta.icon} size={14} color={meta.color} />
                  <Text style={styles.chipText}>{meta.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ── Recents ─────────────────────────────────────── */}
          {recents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent</Text>
              {recents.map(r => {
                const full = getPlaces().find(p => p.id === r.id) ?? r;
                return <PlaceRow key={r.id} place={full} onPress={handleSelectPlace} />;
              })}
            </View>
          )}

          {/* ── Browse grid ──────────────────────────────────── */}
          {!ready && (
            <View style={styles.section}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonCard />
            </View>
          )}

          {ready && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Browse</Text>
              <View style={styles.browseGrid}>
                {categories.map(({ category, count, meta }) => (
                  <TouchableOpacity
                    key={category}
                    style={styles.browseCard}
                    onPress={() => setActiveCategory(category)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.browseCardIcon, { backgroundColor: meta.color + "18" }]}>
                      <Icon name={meta.icon} size={22} color={meta.color} />
                    </View>
                    <Text style={styles.browseCardLabel} numberOfLines={1}>{meta.label}</Text>
                    <Text style={styles.browseCardCount}>{count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── Place sheet ───────────────────────────────────────────── */}
      <PlaceSheet
        place={activePlace}
        userLocation={userLocation}
        fromPlace={fromPlace}
        onClose={() => setActivePlace(null)}
        onNavigate={handleNavigate}
        onSetFrom={setFromPlace}
      />

      {/* ── From picker ───────────────────────────────────────────── */}
      <FromPicker
        visible={showFromPicker}
        onClose={() => setShowFromPicker(false)}
        onSelect={(p) => { setFromPlace(p); setShowFromPicker(false); }}
      />

      {/* ── NavBot ────────────────────────────────────────────────── */}
      <NavBot
        visible={showNavBot}
        initialQuery={navBotQuery}
        onClose={() => { setShowNavBot(false); setNavBotQuery(""); }}
        onNavigate={(p) => { handleSelectPlace(p); handleNavigate(p); }}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    paddingHorizontal: S.base,
    paddingTop:        Platform.OS === "web" ? S.base : Platform.OS === "ios" ? 52 : 28,
    paddingBottom:     S.md,
  },
  headerLabel: { fontSize: 12, fontWeight: "600", color: C.text3, textTransform: "uppercase", letterSpacing: 0.8 },
  headerTitle: { fontSize: 26, fontWeight: "600", color: C.text, marginTop: 2 },

  // Search
  searchWrap: { paddingHorizontal: S.base, paddingBottom: S.sm, gap: S.sm },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: S.sm,
    backgroundColor: C.surface, borderRadius: R.search,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: S.md, paddingVertical: S.sm + 2,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, color: C.text },

  // From pill
  fromPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    backgroundColor: C.brandSoft, borderRadius: R.chip,
    paddingHorizontal: S.md, paddingVertical: 7,
    borderWidth: 1, borderColor: C.brand + "40",
  },
  fromPillText: { fontSize: 13, color: C.brand, fontWeight: "500", maxWidth: 200 },

  // Chips
  chipsScroll:  { flexGrow: 0, marginBottom: S.base },
  chipsContent: { gap: S.sm, paddingRight: S.base },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surface, borderRadius: R.chip,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: S.md, paddingVertical: 9,
    minHeight: 44,
  },
  chipText: { fontSize: 13, color: C.text2, fontWeight: "500" },

  // List
  list:        { flex: 1 },
  listContent: { padding: S.base, paddingBottom: 40 },

  // Section
  section:      { marginBottom: S.xl },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: C.text3, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: S.sm },

  // Place row
  placeRow: {
    flexDirection: "row", alignItems: "center", gap: S.md,
    backgroundColor: C.surface, borderRadius: R.card,
    padding: S.md, marginBottom: S.sm,
    borderWidth: 1, borderColor: C.border,
    minHeight: 56,
  },
  placeRowPressed: { backgroundColor: C.surface2 },
  placeRowIcon:    { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  placeRowText:    { flex: 1 },
  placeRowName:    { fontSize: 14, fontWeight: "500", color: C.text },
  placeRowSub:     { fontSize: 12, color: C.text3, marginTop: 2 },

  // Browse grid
  browseGrid: { flexDirection: "row", flexWrap: "wrap", gap: S.sm },
  browseCard: {
    width: "48%", backgroundColor: C.surface,
    borderRadius: R.card, borderWidth: 1, borderColor: C.border,
    padding: S.md, alignItems: "flex-start", gap: S.sm,
    minHeight: 90,
  },
  browseCardIcon:  { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  browseCardLabel: { fontSize: 13, fontWeight: "600", color: C.text },
  browseCardCount: { fontSize: 12, color: C.text3 },

  // Category list
  catListHeader: {
    flexDirection: "row", alignItems: "center", gap: S.sm,
    paddingHorizontal: S.base,
    paddingTop: Platform.OS === "web" ? S.base : Platform.OS === "ios" ? 52 : 28,
    paddingBottom: S.md,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn:       { padding: S.xs, marginRight: S.xs },
  catListTitle:  { flex: 1, fontSize: 18, fontWeight: "600", color: C.text },
  catListCount:  { fontSize: 13, color: C.text3 },
  stickyHeader:  { fontSize: 12, fontWeight: "700", color: C.text3, textTransform: "uppercase", letterSpacing: 0.7, paddingHorizontal: S.base, paddingVertical: S.sm, backgroundColor: C.bg },

  // Place sheet
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: S.xl, paddingTop: S.md,
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
    gap: S.md,
  },
  sheetHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: S.sm },
  sheetHeader:  { flexDirection: "row", gap: S.md, alignItems: "flex-start" },
  sheetIcon:    { width: 44, height: 44, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sheetName:    { fontSize: 18, fontWeight: "600", color: C.text },
  sheetSub:     { fontSize: 13, color: C.text3, marginTop: 2 },
  sheetPeople:  { fontSize: 13, color: C.text2, marginTop: 4 },
  sheetWalkInfo:{ flexDirection: "row", alignItems: "center", gap: S.xs, backgroundColor: C.brandSoft, borderRadius: R.chip, paddingHorizontal: S.md, paddingVertical: 7, alignSelf: "flex-start" },
  sheetWalkText:{ fontSize: 13, color: C.brand, fontWeight: "500" },
  sheetCourses: { flexDirection: "row", flexWrap: "wrap", gap: S.xs },
  sheetCourseChip: { backgroundColor: C.surface2, borderRadius: R.chip, paddingHorizontal: S.sm, paddingVertical: 4 },
  sheetCourseText: { fontSize: 12, color: C.text2 },
  sheetActions: { flexDirection: "row", gap: S.sm },
  navigateBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm, backgroundColor: C.brand, borderRadius: R.button, paddingVertical: 14, minHeight: 48 },
  navigateBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  secondaryBtn: { backgroundColor: C.surface2, borderRadius: R.button, paddingVertical: 14, paddingHorizontal: S.base, minHeight: 48, justifyContent: "center" },
  secondaryBtnText: { color: C.text, fontSize: 14, fontWeight: "500" },
  sheetTertiary:    { alignItems: "center", paddingVertical: S.xs },
  sheetTertiaryText:{ fontSize: 13, color: C.text3 },

  // From picker
  pickerOverlay:      { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  picker:             { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: S.xl, paddingBottom: Platform.OS === "ios" ? 40 : 28 },
  pickerHeader:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: S.base },
  pickerTitle:        { fontSize: 16, fontWeight: "600", color: C.text },
  pickerMyLocation:   { flexDirection: "row", alignItems: "center", gap: S.sm, padding: S.md, backgroundColor: C.brandSoft, borderRadius: R.card, marginBottom: S.sm, minHeight: 44 },
  pickerMyLocationText:{ fontSize: 14, color: C.brand, fontWeight: "500" },
  pickerSearchBar:    { flexDirection: "row", alignItems: "center", gap: S.sm, backgroundColor: C.surface2, borderRadius: R.input, paddingHorizontal: S.md, paddingVertical: S.sm, marginBottom: S.sm },
  pickerInput:        { flex: 1, fontSize: 14, color: C.text },

  // Empty / loading states
  emptyState:   { alignItems: "center", paddingTop: 48, gap: S.sm },
  emptyTitle:   { fontSize: 16, fontWeight: "600", color: C.text },
  emptySub:     { fontSize: 14, color: C.text3, textAlign: "center", lineHeight: 20 },
  navBotBtn:    { flexDirection: "row", alignItems: "center", gap: S.xs, marginTop: S.sm, backgroundColor: C.brandSoft, borderRadius: R.chip, paddingHorizontal: S.md, paddingVertical: 9 },
  navBotBtnText:{ fontSize: 13, color: C.brand, fontWeight: "600" },
  loadingState: { alignItems: "center", paddingTop: 48, gap: S.sm },
  loadingText:  { fontSize: 14, color: C.text3 },
});
