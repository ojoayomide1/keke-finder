/**
 * src/services/search.js
 *
 * Pure search module. No UI code.
 * Used by Explore screen, NavBot, and any future feature needing place lookup.
 *
 * Ranking order (highest first):
 *   1. Exact name match
 *   2. Name starts with query
 *   3. Fuzzy match via Fuse.js across all indexed fields
 *
 * Returns at most 8 results (spec requirement).
 *
 * @module search
 */

import Fuse from "fuse.js";
import { getPlaces } from "./places";

// ─── FUSE CONFIG ──────────────────────────────────────────────────────────────
const FUSE_OPTIONS = {
  includeScore:      true,
  threshold:         0.35,   // 0 = exact, 1 = match anything — 0.35 is tolerant but not noisy
  ignoreLocation:    true,   // don't penalise matches far from the start of the string
  minMatchCharLength: 2,
  keys: [
    { name: "name",              weight: 3.0 },
    { name: "roomNumber",        weight: 3.0 },
    { name: "aliases",           weight: 2.5 },
    { name: "people.name",       weight: 2.0 },
    { name: "people.role",       weight: 1.5 },
    { name: "courses.code",      weight: 2.0 },
    { name: "courses.title",     weight: 1.5 },
    { name: "buildingName",      weight: 1.0 },
    { name: "room",              weight: 1.5 },
    { name: "category",          weight: 0.5 },
  ],
};

let _fuse = null;
let _indexedCount = 0;

/**
 * Build or rebuild the Fuse index.
 * Called automatically by search() if the place count has changed.
 */
function buildIndex(places) {
  _fuse = new Fuse(places, FUSE_OPTIONS);
  _indexedCount = places.length;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Search places by a query string with optional category filter.
 *
 * @param {string}   query   — raw user input
 * @param {object}   [opts]
 * @param {string}   [opts.category]   — filter to a specific category key
 * @param {string}   [opts.scope]      — "outdoor" | "indoor" | undefined (both)
 * @param {number}   [opts.limit]      — max results (default 8)
 * @returns {Place[]}
 */
export function search(query, opts = {}) {
  const { category, scope, limit: maxResults = 8 } = opts;
  let places = getPlaces();

  // Apply filters first
  if (category) places = places.filter(p => p.category === category);
  if (scope)    places = places.filter(p => p.scope    === scope);

  // Empty query → return all filtered places (for browse/category views)
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return places.slice(0, 50);  // cap at 50 for browse

  // Rebuild index if places changed
  if (!_fuse || _indexedCount !== getPlaces().length) {
    buildIndex(getPlaces());
  }

  // If we filtered, run a filtered Fuse search; otherwise use the global index
  const fuseInstance = (category || scope)
    ? new Fuse(places, FUSE_OPTIONS)
    : _fuse;

  const raw = fuseInstance.search(q);

  // Re-rank: exact and prefix matches bubble to the top
  const results = raw.map(r => {
    const name = r.item.name.toLowerCase();
    let boost = 0;
    if (name === q)              boost = 2;   // exact name
    else if (name.startsWith(q)) boost = 1;   // prefix
    return { ...r, score: (r.score ?? 1) - boost * 0.5 };
  });

  results.sort((a, b) => a.score - b.score);

  return results.slice(0, maxResults).map(r => r.item);
}

/**
 * Find a single place by its exact ID.
 * Used by NavBot to resolve returned IDs.
 *
 * @param {string} id
 * @returns {Place | undefined}
 */
export function getPlaceById(id) {
  return getPlaces().find(p => p.id === id);
}

/**
 * Decide if a query looks like a natural-language question
 * (should trigger NavBot instead of plain search).
 *
 * @param {string} query
 * @returns {boolean}
 */
export function looksLikeQuestion(query) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q.endsWith("?")) return true;
  if (/^(who|where|what|how|when|which|is there|do you|can i)/.test(q)) return true;
  if (q.split(/\s+/).length > 4) return true;
  return false;
}
