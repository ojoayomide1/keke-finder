/**
 * indoor-data.js
 *
 * Loads indoor places from Firestore (indoorPlaces/main) at runtime.
 * Falls back to the bundled indoor_places.json if Firestore is unavailable
 * (offline mode, first load before cache warms up, etc.)
 *
 * The admin panel and local indoor editor both write to Firestore.
 * This file reads from Firestore so the app always reflects the latest data.
 *
 * Each normalized place record:
 * {
 *   id, name, type, buildingId, buildingName,
 *   floor, floorLabel, room,
 *   occupant, title, department,
 *   courses    string[]   from course CSV field
 *   keywords   string[]   from tags CSV field
 *   hint       string|null  from description field
 *   steps      string[]   custom navigation steps (if set in editor)
 *   entrance   string|null  outdoor entrance name for routing
 *   floorPlan  string|null  image URL if available
 *   access, status, capacity, gender
 * }
 */

import { db, doc, getDoc } from "../config/firebase";
import FALLBACK_JSON from "../../map-data/source/indoor_places.json";

let _cache = null;     // normalized flat records
let _rawCache = null;  // raw buildings object

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function splitCsv(str) {
  if (!str) return [];
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeBuildings(buildings) {
  const records = [];
  for (const [buildingId, building] of Object.entries(buildings || {})) {
    const buildingName = building.name ?? buildingId;
    for (const floorObj of building.floors ?? []) {
      const floor      = floorObj.floor ?? 0;
      const floorLabel = floorObj.label ?? (floor === 0 ? "Ground Floor" : `Floor ${floor}`);
      for (const room of floorObj.rooms ?? []) {
        records.push({
          id:          room.id   ?? `${buildingId}_f${floor}_${room.name}`,
          name:        room.name ?? "Unnamed Room",
          type:        room.room_type ?? "room",
          buildingId,
          buildingName,
          floor,
          floorLabel,
          room:        room.name ?? "",
          occupant:    room.occupant    ?? null,
          title:       room.title       ?? null,
          department:  room.department  ?? null,
          courses:     splitCsv(room.course),
          keywords:    splitCsv(room.tags),
          hint:        room.hint || room.description || null,
          steps:       Array.isArray(room.steps) ? room.steps : [],
          entrance:    room.entrance    ?? null,
          floorPlan:   room.floorPlan   ?? null,
          access:      room.access      ?? null,
          status:      room.status      ?? null,
          capacity:    room.capacity    ?? null,
          gender:      room.gender      ?? null,
        });
      }
    }
  }
  return records;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Fetch indoor data from Firestore and cache it.
 * Call once when IndoorScreen mounts.
 * Returns normalized place records array.
 */
export async function fetchIndoorPlaces() {
  try {
    const snap = await getDoc(doc(db, "indoorPlaces", "main"));
    if (snap.exists()) {
      const data = snap.data();
      _rawCache = data.buildings ?? data ?? {};
      // Strip metadata keys
      delete _rawCache.updatedAt;
      delete _rawCache.updatedBy;
    } else {
      // No Firestore data yet — use bundled fallback
      _rawCache = FALLBACK_JSON;
    }
  } catch (err) {
    console.warn("[indoor-data] Firestore unavailable, using bundled JSON:", err.message);
    _rawCache = FALLBACK_JSON;
  }
  _cache = normalizeBuildings(_rawCache);
  return _cache;
}

/**
 * Return cached records. Call fetchIndoorPlaces() first.
 */
export function loadIndoorPlaces() {
  return _cache ?? normalizeBuildings(FALLBACK_JSON);
}

/** Bust cache — call after admin saves to force a re-fetch */
export function bustIndoorCache() {
  _cache    = null;
  _rawCache = null;
}

export function getIndoorBuildings() {
  const raw = _rawCache ?? FALLBACK_JSON;
  return Object.entries(raw).map(([id, b]) => ({
    id,
    name:       b.name ?? id,
    floorCount: (b.floors ?? []).length,
  }));
}

export function getIndoorFloors(buildingId) {
  const raw = _rawCache ?? FALLBACK_JSON;
  return (raw[buildingId]?.floors ?? []).map((f) => ({
    floor:     f.floor ?? 0,
    label:     f.label ?? (f.floor === 0 ? "Ground Floor" : `Floor ${f.floor}`),
    roomCount: (f.rooms ?? []).length,
  }));
}

export function getIndoorRooms(buildingId, floor) {
  return loadIndoorPlaces().filter(
    (p) => p.buildingId === buildingId && p.floor === floor
  );
}
