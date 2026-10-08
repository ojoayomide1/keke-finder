/**
 * campus-data.js
 *
 * Mirrors js/campus-data.js from main branch.
 * Holds the static campus map data and syncs it live from Firestore.
 * All DOM-specific code is stripped â€” this is pure data + Firebase.
 */

import { db, doc, getDoc, onSnapshot, setDoc, serverTimestamp, collection, query, where } from "../config/firebase";
import VERITAS_MAP_PACKAGE from "../../map-data/exports/veritas-map.json";


// â”€â”€â”€ CATEGORY META â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ STATIC CAMPUS DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Coordinates start as null. They are populated by the admin map-editor
// and stored in Firestore under campusData/main. loadCampusDataFromFirestore()
// merges the live values in at runtime.

export const CAMPUS_MAP_DATA = {
  locations: [],
  rideStops: [],
  paths: [],
  buildings: [],
  routingNodes: [],
  routingEdges: [],
};

// â”€â”€â”€ INTERNAL HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


function applyBundledCampusMapPackage() {
  const appData = VERITAS_MAP_PACKAGE?.app;
  if (!appData) return;

  if (Array.isArray(appData.locations)) {
    CAMPUS_MAP_DATA.locations = clone(appData.locations);
  }

  if (Array.isArray(appData.rideStops)) {
    CAMPUS_MAP_DATA.rideStops = clone(appData.rideStops);
  }

  if (Array.isArray(appData.paths)) {
    CAMPUS_MAP_DATA.paths = appData.paths.map(normalizeShape);
  }

  if (Array.isArray(appData.buildings)) {
    CAMPUS_MAP_DATA.buildings = appData.buildings.map(normalizeShape);
  }

  if (Array.isArray(appData.routingNodes)) {
    CAMPUS_MAP_DATA.routingNodes = appData.routingNodes;
  }

  if (Array.isArray(appData.routingEdges)) {
    CAMPUS_MAP_DATA.routingEdges = appData.routingEdges;
  }
}

/** Merge Firestore data into the in-memory CAMPUS_MAP_DATA. */
applyBundledCampusMapPackage();

/**
 * Merge live Firestore data into CAMPUS_MAP_DATA.
 *
 * DISABLED: The bundled veritas-map.json (from npm run map:export) is the
 * single source of truth for ALL map data. The Firestore campusData/main
 * document contains stale legacy data that must not overwrite the QGIS export.
 *
 * To update map data: edit in QGIS → export GeoJSON → npm run map:export → push.
 */
function applyCampusData(_nextData) {
  // intentionally empty — bundled JSON only
}

const CAMPUS_DOC = doc(db, "campusData", "main");

// â”€â”€â”€ PUBLIC API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ CAMPUS ACTIVITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Live counters for the "Campus Activity" card on student/rider home.
 * Mirrors startCampusActivityListeners() from main branch.
 *
 * Fires callback({ ridersOnline, studentsInQueue }) immediately and on change.
 * Returns a single unsubscribe function that stops both listeners.
 *
 * @param {(counts: { ridersOnline: number, studentsInQueue: number }) => void} callback
 * @returns {() => void} unsubscribe
 */
export function listenToCampusActivity(callback) {
  let counts = { ridersOnline: 0, studentsInQueue: 0 };
  let unsubRides = null;
  let unsubQueue = null;

  try {
    // Active keke riders on campus
    unsubRides = onSnapshot(
      query(collection(db, "rides"), where("status", "in", ["waiting", "active"])),
      (snap) => {
        counts = { ...counts, ridersOnline: snap.size };
        callback({ ...counts });
      },
      (err) => {
        console.warn("[campus-activity] Rider count unavailable:", err.code ?? err.message);
      }
    );

    // Students currently in queue (uses rideRequests with status "queued"
    // because security rules don't give students direct waitingQueue access)
    unsubQueue = onSnapshot(
      query(collection(db, "rideRequests"), where("status", "==", "queued")),
      (snap) => {
        counts = { ...counts, studentsInQueue: snap.size };
        callback({ ...counts });
      },
      (err) => {
        console.warn("[campus-activity] Queue count unavailable:", err.code ?? err.message);
      }
    );
  } catch (err) {
    console.warn("[campus-activity] Failed to start listeners:", err);
  }

  return () => {
    if (unsubRides) unsubRides();
    if (unsubQueue) unsubQueue();
  };
}
