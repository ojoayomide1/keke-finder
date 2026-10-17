/**
 * src/services/places.js
 *
 * Unified place data layer for NavCamp.
 * Combines outdoor places (QGIS export) and indoor places (Firestore)
 * into one flat array of Place records.
 *
 * This is the single source of truth consumed by:
 *   - Explore screen (search, browse, category chips)
 *   - Ride screen (pickup/dropoff picker)
 *   - NavBot (place context)
 *   - Map tab (markers)
 *
 * Place shape:
 * {
 *   id:           string         stable ID from QGIS or indoor editor
 *   name:         string
 *   category:     string         normalised category key
 *   subCategory?: string
 *   scope:        "outdoor"|"indoor"
 *   buildingId?:  string         indoor only
 *   buildingName?:string         indoor only
 *   floor?:       number         indoor only
 *   floorLabel?:  string         indoor only
 *   room?:        string         indoor only
 *   coords?:      {lat,lng}      outdoor places + building centres
 *   entrance?:    {lat,lng}      per-building routing target
 *   aliases?:     string[]       alternate names / abbreviations
 *   people?:      {name,role}[]  occupants / lecturers
 *   courses?:     {code,title}[] associated courses
 *   hours?:       string
 *   hint?:        string         "third door on the left"
 *   steps?:       string[]       custom nav steps
 *   floorPlanUrl?:string
 * }
 */

import { db, doc, getDoc } from "../config/firebase";
import VERITAS_MAP from "../../map-data/exports/veritas-map.json";
import FALLBACK_INDOOR from "../../map-data/source/indoor_places.json";

// ─── CATEGORY NORMALISATION ───────────────────────────────────────────────────
// The QGIS export has some typos and inconsistencies — normalise them here.
const CATEGORY_NORM = {
  "Faculty":   "faculty",
  "resturant": "restaurant",
  "resaurant": "restaurant",
  "shop":      "service",   // treat shops as services for now
};

function normaliseCategory(raw) {
  return CATEGORY_NORM[raw] ?? raw ?? "service";
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function splitCsv(str) {
  if (!str) return [];
  return str.split(",").map(s => s.trim()).filter(Boolean);
}

function parseCourses(csvStr) {
  // e.g. "CSC 301, CSC 302" → [{code:"CSC 301",title:"CSC 301"}]
  return splitCsv(csvStr).map(c => ({ code: c, title: c }));
}

// ─── OUTDOOR NORMALISER ───────────────────────────────────────────────────────
/**
 * Convert a QGIS location record into a Place.
 * Reports missing required fields in development.
 */
function normaliseOutdoor(loc) {
  if (!loc.id)   console.warn("[places] outdoor record missing id:", loc.name);
  if (!loc.name) console.warn("[places] outdoor record missing name:", loc.id);

  return {
    id:       loc.id   ?? `outdoor_${Math.random().toString(36).slice(2)}`,
    name:     loc.name ?? "Unknown",
    category: normaliseCategory(loc.category),
    scope:    "outdoor",
    coords:   Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
                ? { lat: loc.lat, lng: loc.lng }
                : undefined,
    aliases:  loc.aliases ?? [],
    people:   [],
    courses:  [],
  };
}

// ─── INDOOR NORMALISER ────────────────────────────────────────────────────────
function normaliseIndoorBuildings(buildings) {
  const places = [];

  for (const [buildingId, building] of Object.entries(buildings ?? {})) {
    const buildingName = building.name ?? buildingId;

    for (const floorObj of building.floors ?? []) {
      const floor      = floorObj.floor  ?? 0;
      const floorLabel = floorObj.label  ?? (floor === 0 ? "Ground Floor" : `Floor ${floor}`);

      for (const room of floorObj.rooms ?? []) {
        const courses = parseCourses(room.course);

        // people: occupant + title as a single person entry
        const people = room.occupant
          ? [{ name: room.occupant, role: room.title ?? undefined }]
          : [];

        // aliases: tags split into keywords
        const aliases = splitCsv(room.tags);

        if (!room.id)   console.warn("[places] indoor room missing id in", buildingId, room.name);
        if (!room.name) console.warn("[places] indoor room missing name in", buildingId);

        places.push({
          id:           room.id   ?? `${buildingId}_f${floor}_${room.name ?? "room"}`,
          name:         room.name ?? "Unnamed Room",
          category:     room.room_type ?? "room",
          scope:        "indoor",
          buildingId,
          buildingName,
          floor,
          floorLabel,
          room:         room.name,
          aliases,
          people,
          courses,
          hours:        room.hours        ?? undefined,
          hint:         room.hint || room.description || undefined,
          steps:        Array.isArray(room.steps) ? room.steps : [],
          entrance:     room.entrance     ?? undefined,
          floorPlanUrl: room.floorPlan    ?? undefined,
        });
      }
    }
  }
  return places;
}

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _places   = null;   // unified flat array
let _loading  = false;
let _callbacks = [];    // listeners waiting for data

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Load all places (outdoor + indoor) into memory.
 * Safe to call multiple times — only fetches once per app session.
 * Returns the unified Place array.
 *
 * @returns {Promise<Place[]>}
 */
export async function loadPlaces() {
  if (_places) return _places;
  if (_loading) {
    // Already in flight — wait for it
    return new Promise(resolve => _callbacks.push(resolve));
  }

  _loading = true;

  // 1. Outdoor places from bundled QGIS export
  const outdoor = (VERITAS_MAP?.app?.locations ?? []).map(normaliseOutdoor);

  // 2. Indoor places from Firestore (fallback to bundled JSON)
  let indoorBuildings = FALLBACK_INDOOR;
  try {
    const snap = await getDoc(doc(db, "indoorPlaces", "main"));
    if (snap.exists()) {
      const data = snap.data();
      indoorBuildings = data.buildings ?? data ?? FALLBACK_INDOOR;
    }
  } catch (err) {
    console.warn("[places] Firestore unavailable, using bundled indoor data:", err.message);
  }
  const indoor = normaliseIndoorBuildings(indoorBuildings);

  _places = [...outdoor, ...indoor];
  _loading = false;

  // Resolve any waiting callers
  _callbacks.forEach(cb => cb(_places));
  _callbacks = [];

  if (__DEV__) {
    console.log(`[places] Loaded ${outdoor.length} outdoor + ${indoor.length} indoor = ${_places.length} total`);
  }

  return _places;
}

/**
 * Return cached places synchronously.
 * Call loadPlaces() first. Returns [] if not yet loaded.
 */
export function getPlaces() {
  return _places ?? [];
}

/**
 * Bust the cache — call after admin saves new indoor data.
 */
export function bustPlacesCache() {
  _places  = null;
  _loading = false;
}

/**
 * Get all unique category values from loaded places.
 * Used to build the category chips in Explore.
 */
export function getCategories() {
  const places = getPlaces();
  const counts = {};
  for (const p of places) {
    counts[p.category] = (counts[p.category] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }));
}

/**
 * Category display metadata — label, icon name, colour.
 * Used by Explore chips, browse grid, and map markers.
 */
export const CATEGORY_META = {
  boys_hostel:  { label: "Boys hostels",     icon: "bed",           color: "#2563EB" },
  girls_hostel: { label: "Girls hostels",    icon: "bed",           color: "#DB2777" },
  faculty:      { label: "Faculties",        icon: "graduation-cap",color: "#7C3AED" },
  block:        { label: "Blocks",           icon: "building",      color: "#475569" },
  hall:         { label: "Lecture halls",    icon: "graduation-cap",color: "#EA580C" },
  restaurant:   { label: "Food",             icon: "utensils",      color: "#16A34A" },
  gate:         { label: "Gates",            icon: "map-pin",       color: "#0F766E" },
  sport:        { label: "Sports",           icon: "dumbbell",      color: "#DC2626" },
  service:      { label: "Services",         icon: "info",          color: "#0891B2" },
  pickup:       { label: "Keke stops",       icon: "car",           color: "#1E7B4C" },
  office:       { label: "Offices",          icon: "building",      color: "#2563EB" },
  lecture_hall: { label: "Lecture halls",    icon: "graduation-cap",color: "#7C3AED" },
  lab:          { label: "Labs",             icon: "flask",         color: "#0891B2" },
  restroom:     { label: "Restrooms",        icon: "map-pin",       color: "#6B7280" },
};

export function getCategoryMeta(category) {
  return CATEGORY_META[category] ?? { label: category, icon: "map-pin", color: "#6B7280" };
}
