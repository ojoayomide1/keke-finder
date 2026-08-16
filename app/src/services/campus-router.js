/**
 * campus-router.js
 *
 * Pure JS port of js/modules/campus-router.js from the main branch.
 * Zero changes to the routing algorithm — only the import is different:
 *   main:  getCampusMapData() from "../campus-data.js"   (DOM / web)
 *   here:  CAMPUS_MAP_DATA   from "../services/campus-data" (React Native)
 *
 * Algorithm overview
 * ──────────────────
 *  1. Build a graph from the admin-defined campus path segments.
 *  2. Snap the origin + destination to their nearest path segment,
 *     inserting temporary "anchor" nodes on the graph.
 *  3. Run Dijkstra from anchor-start → anchor-end.
 *  4. Return the ordered list of [lat, lng] points that form the route.
 *
 * If no paths are mapped yet, or the endpoints are too far from any path,
 * the function gracefully falls back to a straight-line route.
 *
 * Exports:
 *   calculateCampusRoute(from, to) → { points, distance, routed, reason }
 *   getDistanceMeters(a, b)        → number
 */

import { CAMPUS_MAP_DATA } from "./campus-data";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M        = 6_371_000;
const CONNECT_TOLERANCE_M   = 10;   // auto-connect nearby nodes
const SNAP_DISTANCE_LIMIT_M = 180;  // max snap distance for route anchors

// ─── COORDINATE HELPERS ───────────────────────────────────────────────────────

function normalizePoint(point) {
  if (Array.isArray(point)) {
    return [Number(point[0]), Number(point[1])];
  }
  if (point && typeof point === "object") {
    return [Number(point.lat ?? point[0]), Number(point.lng ?? point[1])];
  }
  return [NaN, NaN];
}

function isValidPoint(point) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function pointKey(point) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

/** Convert lat/lng to local Cartesian x/y metres relative to an origin. */
function toXY(point, origin) {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  return {
    x: (point[1] - origin[1]) * lngScale,
    y: (point[0] - origin[0]) * latScale,
  };
}

function fromXY(xy, origin) {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos((origin[0] * Math.PI) / 180);
  return [
    origin[0] + xy.y / latScale,
    origin[1] + xy.x / lngScale,
  ];
}

/** Project a point onto a line segment [from → to] and return the closest point + distance. */
function closestPointOnSegment(point, from, to) {
  const origin = point;
  const p  = toXY(point, origin);
  const a  = toXY(from,  origin);
  const b  = toXY(to,    origin);
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const lengthSq = ab.x ** 2 + ab.y ** 2;
  const t = lengthSq === 0
    ? 0
    : Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / lengthSq));

  const projected = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return {
    point:    fromXY(projected, origin),
    distance: Math.hypot(p.x - projected.x, p.y - projected.y),
    ratio:    t,
  };
}

// ─── HAVERSINE DISTANCE ───────────────────────────────────────────────────────

export function getDistanceMeters(a, b) {
  const from = normalizePoint(a);
  const to   = normalizePoint(b);
  if (!isValidPoint(from) || !isValidPoint(to)) return Infinity;

  const fromLat  = (from[0] * Math.PI) / 180;
  const toLat    = (to[0]   * Math.PI) / 180;
  const deltaLat = ((to[0] - from[0]) * Math.PI) / 180;
  const deltaLng = ((to[1] - from[1]) * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ─── GRAPH CONSTRUCTION ───────────────────────────────────────────────────────

function addNode(graph, point) {
  const key = pointKey(point);
  if (!graph.nodes.has(key)) {
    graph.nodes.set(key, { key, point, edges: new Map() });
  }
  return graph.nodes.get(key);
}

function addEdge(fromNode, toNode) {
  const distance = getDistanceMeters(fromNode.point, toNode.point);
  if (!Number.isFinite(distance) || distance <= 0) return;

  const fwd = fromNode.edges.get(toNode.key);
  const bwd = toNode.edges.get(fromNode.key);
  if (fwd == null || distance < fwd) fromNode.edges.set(toNode.key, distance);
  if (bwd == null || distance < bwd) toNode.edges.set(fromNode.key, distance);
}

function buildCampusGraph() {
  const graph = { nodes: new Map(), segments: [], anchors: [] };

  (CAMPUS_MAP_DATA.paths ?? []).forEach((path) => {
    const points = Array.isArray(path.points)
      ? path.points.map(normalizePoint).filter(isValidPoint)
      : [];

    for (let i = 1; i < points.length; i++) {
      const fromNode = addNode(graph, points[i - 1]);
      const toNode   = addNode(graph, points[i]);
      addEdge(fromNode, toNode);
      graph.segments.push({ fromNode, toNode });
    }
  });

  // Auto-connect nodes that are within the tolerance (e.g. path intersections)
  const nodes = Array.from(graph.nodes.values());
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (getDistanceMeters(nodes[i].point, nodes[j].point) <= CONNECT_TOLERANCE_M) {
        addEdge(nodes[i], nodes[j]);
      }
    }
  }

  return graph;
}

// ─── ROUTE ANCHORING ──────────────────────────────────────────────────────────

/**
 * Insert a temporary node on the graph that represents an arbitrary lat/lng
 * point snapped to the nearest path segment.
 */
function addRouteAnchor(graph, point, id) {
  let nearest         = null;
  let nearestDistance = Infinity;

  graph.segments.forEach((segment) => {
    const projected = closestPointOnSegment(point, segment.fromNode.point, segment.toNode.point);
    if (projected.distance < nearestDistance) {
      nearest         = { ...segment, point: projected.point, ratio: projected.ratio };
      nearestDistance = projected.distance;
    }
  });

  if (!nearest) return { node: null, distance: Infinity };
  if (nearestDistance > SNAP_DISTANCE_LIMIT_M) return { node: null, distance: nearestDistance };

  // If the snap is essentially at an existing endpoint, reuse it
  if (nearest.ratio <= 0.02) return { node: nearest.fromNode, distance: nearestDistance };
  if (nearest.ratio >= 0.98) return { node: nearest.toNode,   distance: nearestDistance };

  // Otherwise insert a new anchor node mid-segment
  const anchorKey  = `${id}:${pointKey(nearest.point)}`;
  const anchorNode = { key: anchorKey, point: nearest.point, edges: new Map() };
  graph.nodes.set(anchorKey, anchorNode);
  addEdge(anchorNode, nearest.fromNode);
  addEdge(anchorNode, nearest.toNode);

  // Connect to other anchors on the same segment
  graph.anchors
    .filter(
      (a) =>
        a.fromKey === nearest.fromNode.key &&
        a.toKey   === nearest.toNode.key
    )
    .forEach((a) => addEdge(anchorNode, a.node));

  graph.anchors.push({
    fromKey: nearest.fromNode.key,
    toKey:   nearest.toNode.key,
    node:    anchorNode,
  });

  return { node: anchorNode, distance: nearestDistance };
}

// ─── DIJKSTRA ─────────────────────────────────────────────────────────────────

function findShortestPath(graph, startKey, endKey) {
  const distances = new Map();
  const previous  = new Map();
  const unvisited = new Set(graph.nodes.keys());

  graph.nodes.forEach((_, key) => distances.set(key, Infinity));
  distances.set(startKey, 0);

  while (unvisited.size > 0) {
    let currentKey      = null;
    let currentDistance = Infinity;

    unvisited.forEach((key) => {
      const d = distances.get(key);
      if (d < currentDistance) {
        currentKey      = key;
        currentDistance = d;
      }
    });

    if (currentKey == null || currentDistance === Infinity) break;
    if (currentKey === endKey) break;

    unvisited.delete(currentKey);
    graph.nodes.get(currentKey).edges.forEach((edgeDist, neighborKey) => {
      if (!unvisited.has(neighborKey)) return;
      const next = currentDistance + edgeDist;
      if (next < distances.get(neighborKey)) {
        distances.set(neighborKey, next);
        previous.set(neighborKey, currentKey);
      }
    });
  }

  if (startKey !== endKey && !previous.has(endKey)) return null;

  const path = [];
  let cursor = endKey;
  path.unshift(cursor);
  while (cursor !== startKey) {
    cursor = previous.get(cursor);
    if (!cursor) return null;
    path.unshift(cursor);
  }
  return path.map((key) => graph.nodes.get(key).point);
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function routeDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += getDistanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function directRoute(from, to, reason) {
  const points = [from, to];
  return { points, distance: routeDistance(points), routed: false, reason };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Calculate a walking route on campus between two lat/lng points.
 *
 * @param {[number,number]|{lat,lng}} fromInput
 * @param {[number,number]|{lat,lng}} toInput
 *
 * @returns {{
 *   points:   [number,number][],  // ordered array of [lat, lng]
 *   distance: number | null,      // metres
 *   routed:   boolean,            // true = followed paths, false = straight line
 *   reason:   string
 * }}
 */
export function calculateCampusRoute(fromInput, toInput) {
  const from = normalizePoint(fromInput);
  const to   = normalizePoint(toInput);

  if (!isValidPoint(from) || !isValidPoint(to)) {
    return { points: [], distance: null, routed: false, reason: "Invalid route coordinates" };
  }

  const graph = buildCampusGraph();

  if (graph.nodes.size === 0) {
    return directRoute(from, to, "No campus paths mapped yet");
  }

  const start = addRouteAnchor(graph, from, "start");
  const end   = addRouteAnchor(graph, to,   "end");

  if (!start.node || !end.node) {
    return directRoute(from, to, "No nearby campus path found");
  }

  const path = findShortestPath(graph, start.node.key, end.node.key);
  if (!path || path.length === 0) {
    return directRoute(from, to, "Campus paths are not connected");
  }

  const points = [from, ...path, to];
  return {
    points,
    distance: routeDistance(points),
    routed:   true,
    reason:   "Campus path route",
  };
}
