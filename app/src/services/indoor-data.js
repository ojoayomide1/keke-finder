/**
 * indoor-data.js
 *
 * Loads indoor_places.json and normalizes it into a flat array of place records.
 * The UI and search function never touch the raw JSON structure.
 *
 * Each place record shape:
 * {
 *   id:           string,
 *   name:         string,
 *   type:         string,   // office | lecture_hall | lab | restroom | ...
 *   buildingId:   string,
 *   buildingName: string,
 *   floor:        number,
 *   floorLabel:   string,   // "Ground Floor", "First Floor", etc.
 *   room:         string,   // room name as entered in JSON
 *   occupant:     string | null,
 *   title:        string | null,
 *   department:   string | null,
 *   courses:      string[],  // split from "LAW 101, LAW 201"
 *   keywords:     string[],  // split from tags field
 *   hint:         string | null,  // from description field
 *   access:       string | null,
 *   status:       string | null,
 *   capacity:     number | null,
 *   gender:       string | null,
 * }
 *
 * JSON gaps (as of current indoor_places.json):
 * - No dedicated `keywords` field → using `tags` (comma-separated string)
 * - No dedicated `hint` field     → using `description`
 * - No `floorPlan` / image field  → Floor plan button hidden for all current entries
 * - `course` is a flat string     → split on comma at normalize time
 * - Only Faculty of Law has data  → all other buildings return empty
 */

import RAW_INDOOR from "../../map-data/source/indoor_places.json";

/** @type {import('./indoor-data').PlaceRecord[] | null} */
let _cache = null;

/**
 * Split a nullable comma-separated string into a trimmed string array.
 * @param {string | null | undefined} str
 * @returns {string[]}
 */
function splitCsv(str) {
  if (!str) return [];
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Normalize the raw indoor JSON into a flat array of place records.
 * Call once at startup; result is cached.
 *
 * @returns {PlaceRecord[]}
 */
export function loadIndoorPlaces() {
  if (_cache) return _cache;

  const records = [];

  for (const [buildingId, building] of Object.entries(RAW_INDOOR)) {
    const buildingName = building.name ?? buildingId;

    for (const floorObj of building.floors ?? []) {
      const floor      = floorObj.floor ?? 0;
      const floorLabel = floorObj.label ?? `Floor ${floor}`;

      for (const room of floorObj.rooms ?? []) {
        records.push({
          id:           room.id ?? `${buildingId}_f${floor}_${Math.random()}`,
          name:         room.name ?? "Unnamed Room",
          type:         room.room_type ?? "room",
          buildingId,
          buildingName,
          floor,
          floorLabel,
          room:         room.name ?? "",
          occupant:     room.occupant   ?? null,
          title:        room.title      ?? null,
          department:   room.department ?? null,
          courses:      splitCsv(room.course),
          keywords:     splitCsv(room.tags),
          hint:         room.description ?? null,
          access:       room.access  ?? null,
          status:       room.status  ?? null,
          capacity:     room.capacity ?? null,
          gender:       room.gender  ?? null,
        });
      }
    }
  }

  _cache = records;
  return records;
}

/**
 * Bust the cache — call this after the indoor editor saves new data
 * so the next loadIndoorPlaces() call re-reads the file.
 * (Only relevant in development / hot-reload scenarios.)
 */
export function bustIndoorCache() {
  _cache = null;
}

/**
 * Get all unique building entries from the raw JSON.
 * Used for the Browse view.
 *
 * @returns {{ id: string, name: string, floorCount: number }[]}
 */
export function getIndoorBuildings() {
  return Object.entries(RAW_INDOOR).map(([id, b]) => ({
    id,
    name:       b.name ?? id,
    floorCount: (b.floors ?? []).length,
  }));
}

/**
 * Get all floors for a given building.
 *
 * @param {string} buildingId
 * @returns {{ floor: number, label: string, roomCount: number }[]}
 */
export function getIndoorFloors(buildingId) {
  const building = RAW_INDOOR[buildingId];
  if (!building) return [];
  return (building.floors ?? []).map((f) => ({
    floor:     f.floor ?? 0,
    label:     f.label ?? `Floor ${f.floor}`,
    roomCount: (f.rooms ?? []).length,
  }));
}

/**
 * Get all rooms on a specific floor of a building.
 * Returns full normalized place records.
 *
 * @param {string} buildingId
 * @param {number} floor
 * @returns {PlaceRecord[]}
 */
export function getIndoorRooms(buildingId, floor) {
  return loadIndoorPlaces().filter(
    (p) => p.buildingId === buildingId && p.floor === floor
  );
}
