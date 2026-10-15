/**
 * indoor-search.js
 *
 * Pure search function for indoor places. No UI code inside.
 * Imported by IndoorScreen and (future) AI chat.
 *
 * Usage:
 *   import { searchIndoor } from '../services/indoor-search';
 *   const results = searchIndoor('dean', 'all');
 */

import { loadIndoorPlaces } from "./indoor-data";

// Filter values that match the UI chip labels
export const INDOOR_FILTERS = {
  ALL:     "all",
  OFFICE:  "office",
  LECTURER:"lecturer",
  HALL:    "lecture_hall",
  COURSE:  "course",
};

/**
 * Fuzzy-tolerant indoor place search.
 *
 * Ranking (highest first):
 *   3 — exact name match
 *   2 — name starts with query
 *   1 — any field contains query (occupant, courses, keywords, building, room)
 *   0 — typo match (each word of query appears somewhere across all text)
 *
 * @param {string} query   — raw user input, may be empty
 * @param {string} filter  — one of INDOOR_FILTERS values
 * @returns {PlaceRecord[]} sorted array, max 50 results
 */
export function searchIndoor(query, filter = INDOOR_FILTERS.ALL) {
  const places = loadIndoorPlaces();
  const q      = query.trim().toLowerCase();

  // Apply type filter first
  const filtered = filter === INDOOR_FILTERS.ALL
    ? places
    : places.filter((p) => matchesFilter(p, filter));

  // Empty query → return all filtered results (browse mode)
  if (!q) return filtered;

  const scored = filtered
    .map((p) => ({ place: p, score: scorePlace(p, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ place }) => place).slice(0, 50);
}

/**
 * Check if a place matches the active filter chip.
 */
function matchesFilter(place, filter) {
  switch (filter) {
    case INDOOR_FILTERS.OFFICE:
      return place.type === "office";
    case INDOOR_FILTERS.LECTURER:
      // Lecturer offices or rooms with an occupant who has a title
      return place.type === "office" && !!place.occupant;
    case INDOOR_FILTERS.HALL:
      return place.type === "lecture_hall";
    case INDOOR_FILTERS.COURSE:
      return place.courses.length > 0;
    default:
      return true;
  }
}

/**
 * Score a place against a query string.
 * Returns 0 if no match, higher numbers for better matches.
 */
function scorePlace(place, q) {
  const name     = (place.name        ?? "").toLowerCase();
  const occupant = (place.occupant    ?? "").toLowerCase();
  const dept     = (place.department  ?? "").toLowerCase();
  const building = (place.buildingName?? "").toLowerCase();
  const room     = (place.room        ?? "").toLowerCase();
  const keywords = place.keywords.map((k) => k.toLowerCase()).join(" ");
  const courses  = place.courses.map((c)  => c.toLowerCase()).join(" ");
  const allText  = [name, occupant, dept, building, room, keywords, courses].join(" ");

  // Exact name match
  if (name === q) return 3;

  // Name starts with query
  if (name.startsWith(q)) return 2;

  // Any single field contains the full query
  if (
    name.includes(q)     ||
    occupant.includes(q) ||
    dept.includes(q)     ||
    building.includes(q) ||
    room.includes(q)     ||
    keywords.includes(q) ||
    courses.includes(q)
  ) return 1;

  // Typo tolerance: every word of the query appears somewhere in allText
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => allText.includes(w))) return 1;

  // Single-word partial match across all text (covers abbreviations)
  if (words.length === 1 && allText.includes(words[0])) return 1;

  return 0;
}
