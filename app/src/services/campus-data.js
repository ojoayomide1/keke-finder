/**
 * campus-data.js
 *
 * Mirrors js/campus-data.js from main branch.
 * Holds the static campus map data and syncs it live from Firestore.
 * All DOM-specific code is stripped — this is pure data + Firebase.
 */

import { db, doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "../config/firebase";

// ─── CATEGORY META ───────────────────────────────────────────────────────────
// Used to colour map markers and filter the map legend.

export const CAMPUS_CATEGORY_META = {
  boys_hostel:  { label: "Boys Hostels",      icon: "bed",           color: "#2563eb" },
  girls_hostel: { label: "Girls Hostels",     icon: "person-dress",  color: "#db2777" },
  faculty:      { label: "Faculties",         icon: "graduation-cap",color: "#7c3aed" },
  block:        { label: "Blocks",            icon: "building",      color: "#475569" },
  hall:         { label: "Halls",             icon: "chalkboard",    color: "#ea580c" },
  restaurant:   { label: "Restaurants",       icon: "utensils",      color: "#16a34a" },
  gate:         { label: "Gates",             icon: "archway",       color: "#0f766e" },
  sport:        { label: "Sports",            icon: "basketball",    color: "#dc2626" },
  service:      { label: "Services",          icon: "circle-info",   color: "#0891b2" },
  pickup:       { label: "Pickup / Drop-off", icon: "car-side",      color: "#00c48c" },
};

// ─── STATIC CAMPUS DATA ──────────────────────────────────────────────────────
// Coordinates start as null. They are populated by the admin map-editor
// and stored in Firestore under campusData/main. loadCampusDataFromFirestore()
// merges the live values in at runtime.

export const CAMPUS_MAP_DATA = {
  locations: [
    { id: "hostel_l",           name: "Hostel L",                              category: "boys_hostel",  lat: null, lng: null },
    { id: "hostel_i",           name: "Hostel I",                              category: "boys_hostel",  lat: null, lng: null },
    { id: "hostel_m",           name: "Hostel M",                              category: "boys_hostel",  lat: null, lng: null },
    { id: "hostel_n",           name: "Hostel N",                              category: "boys_hostel",  lat: null, lng: null },
    { id: "hostel_s",           name: "Hostel S",                              category: "boys_hostel",  lat: null, lng: null },
    { id: "new_kelson",         name: "New Kelson",                            category: "girls_hostel", lat: null, lng: null },
    { id: "faculty_law",        name: "Faculty of Law",                        category: "faculty",      lat: null, lng: null },
    { id: "faculty_pharmacy",   name: "Faculty of Pharmacy",                   category: "faculty",      lat: null, lng: null },
    { id: "faculty_medicine",   name: "Faculty of Medicine",                   category: "faculty",      lat: null, lng: null },
    { id: "faculty_computing",  name: "Faculty of Computing (Software Bldg)", category: "faculty",      lat: null, lng: null },
    { id: "block_a",            name: "Block A",                               category: "block",        lat: null, lng: null },
    { id: "block_b",            name: "Block B",                               category: "block",        lat: null, lng: null },
    { id: "block_c",            name: "Block C",                               category: "block",        lat: null, lng: null },
    { id: "block_d",            name: "Block D",                               category: "block",        lat: null, lng: null },
    { id: "nlt",                name: "New Lecture Theatre (NLT)",             category: "hall",         lat: null, lng: null },
    { id: "mph",                name: "Multipurpose Hall (MPH)",               category: "hall",         lat: null, lng: null },
    { id: "auditorium",         name: "Auditorium",                            category: "hall",         lat: null, lng: null },
    { id: "ggs",                name: "GGs",                                   category: "restaurant",   lat: null, lng: null },
    { id: "munchbox",           name: "MunchBox",                              category: "restaurant",   lat: null, lng: null },
    { id: "ase_cafe",           name: "Ase Cafe",                              category: "restaurant",   lat: null, lng: null },
    { id: "school_gate",        name: "School Gate",                           category: "gate",         lat: null, lng: null },
    { id: "boys_hostel_gate",   name: "Boys Hostel Gate",                      category: "gate",         lat: null, lng: null },
    { id: "girls_hostel_gate",  name: "Girls Hostel Gate",                     category: "gate",         lat: null, lng: null },
    { id: "basketball_court",   name: "Basketball Court",                      category: "sport",        lat: null, lng: null },
    { id: "volleyball_court",   name: "Volleyball Court",                      category: "sport",        lat: null, lng: null },
    { id: "table_tennis_court", name: "Table Tennis Court",                    category: "sport",        lat: null, lng: null },
    { id: "badminton_court",    name: "Badminton Court",                       category: "sport",        lat: null, lng: null },
    { id: "football_field",     name: "Football Field",                        category: "sport",        lat: null, lng: null },
    { id: "ict",                name: "ICT",                                   category: "service",      lat: null, lng: null },
    { id: "clinic",             name: "Clinic",                                category: "service",      lat: null, lng: null },
    { id: "chapel",             name: "Chapel",                                category: "service",      lat: null, lng: null },
    { id: "senate",             name: "Senate",                                category: "service",      lat: null, lng: null },
  ],

  rideStops: [
    {
      id: "school_gate_stop",
      name: "School Gate Stop",
      type: "pickup_dropoff",
      lat: null, lng: null,
      serves: ["school_gate"],
    },
    {
      id: "boys_hostel_gate_stop",
      name: "Boys Hostel Gate Stop",
      type: "pickup_dropoff",
      lat: null, lng: null,
      serves: ["boys_hostel_gate", "hostel_l", "hostel_i", "hostel_m", "hostel_n", "hostel_s"],
    },
    {
      id: "girls_hostel_gate_stop",
      name: "Girls Hostel Gate Stop",
      type: "pickup_dropoff",
      lat: null, lng: null,
      serves: ["girls_hostel_gate", "new_kelson"],
    },
    {
      id: "block_d_stop",
      name: "Block D Stop",
      type: "pickup_dropoff",
      lat: null, lng: null,
      serves: ["block_d"],
    },
  ],

  paths: [],
  buildings: [],
};

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Normalize a lat/lng point regardless of how Firestore stored it. */
function normalizePoint(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  if (point && typeof point === "object") return [Number(point.lat), Number(point.lng)];
  return [NaN, NaN];
}

function normalizeShape(shape) {
  return {
    ...shape,
    points: Array.isArray(shape?.points)
      ? shape.points
          .map(normalizePoint)
          .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      : [],
  };
}

/** Merge Firestore data into the in-memory CAMPUS_MAP_DATA. */
function applyCampusData(nextData) {
  if (Array.isArray(nextData?.locations))     CAMPUS_MAP_DATA.locations     = clone(nextData.locations);
  if (Array.isArray(nextData?.rideStops))     CAMPUS_MAP_DATA.rideStops     = clone(nextData.rideStops);
  if (Array.isArray(nextData?.paths))         CAMPUS_MAP_DATA.paths         = nextData.paths.map(normalizeShape);
  if (Array.isArray(nextData?.buildings))     CAMPUS_MAP_DATA.buildings     = nextData.buildings.map(normalizeShape);
}

const CAMPUS_DOC = doc(db, "campusData", "main");

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/** Returns all locations that have coordinates (used for map markers). */
export function getCampusLocationsForMap() {
  return CAMPUS_MAP_DATA.locations.filter(hasCoordinates);
}

/** Returns ride stops that have coordinates (used in pickup/dropoff pickers). */
export function getRideStops() {
  return CAMPUS_MAP_DATA.rideStops.filter(hasCoordinates);
}

/** Returns campus paths/roads as arrays of {lat,lng} coordinates. */
export function getCampusPaths() {
  return (CAMPUS_MAP_DATA.paths || []).filter(
    p => Array.isArray(p.points) && p.points.length >= 2
  );
}

/** Returns campus buildings as arrays of {lat,lng} polygon coordinates. */
export function getCampusBuildings() {
  return (CAMPUS_MAP_DATA.buildings || []).filter(
    b => Array.isArray(b.points) && b.points.length >= 3
  );
}

/** Returns true if a map item has valid lat/lng. */
export function hasCoordinates(item) {
  return Number.isFinite(item?.lat) && Number.isFinite(item?.lng);
}

export function getCampusCategoryMeta(category) {
  return CAMPUS_CATEGORY_META[category] ?? CAMPUS_CATEGORY_META.service;
}

/**
 * One-time fetch of campus data from Firestore.
 * Call this on app startup before mounting the map.
 * Returns true if data was found, false if using bundled defaults.
 */
export async function loadCampusDataFromFirestore() {
  try {
    const snap = await getDoc(CAMPUS_DOC);
    if (snap.exists() && snap.data()?.mapData) {
      applyCampusData(snap.data().mapData);
      return true;
    }
  } catch (err) {
    console.warn("[campus-data] Using bundled defaults:", err.code ?? err.message);
  }
  return false;
}

/**
 * Subscribe to live campus data updates.
 * Calls `callback(CAMPUS_MAP_DATA)` immediately and on every change.
 * Returns an unsubscribe function.
 *
 * @param {(data: typeof CAMPUS_MAP_DATA) => void} callback
 * @returns {() => void} unsubscribe
 */
export function listenToCampusData(callback) {
  let unsubscribeRemote = null;

  try {
    unsubscribeRemote = onSnapshot(
      CAMPUS_DOC,
      (snap) => {
        if (snap.exists() && snap.data()?.mapData) {
          applyCampusData(snap.data().mapData);
        }
        callback(CAMPUS_MAP_DATA);
      },
      (err) => {
        console.warn("[campus-data] Live listener unavailable:", err.code ?? err.message);
        callback(CAMPUS_MAP_DATA);
      }
    );
  } catch (err) {
    console.warn("[campus-data] Failed to subscribe:", err);
    callback(CAMPUS_MAP_DATA);
  }

  return () => {
    if (unsubscribeRemote) unsubscribeRemote();
  };
}
