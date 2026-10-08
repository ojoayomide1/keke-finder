/**
 * campus-router.js
 *
 * Campus walking/driving route calculator.
 *
 * Algorithm
 * ─────────
 * 1. Build a weighted graph from routing_nodes + routing_edges exported
 *    from QGIS. Each edge carries a real-world metre distance.
 * 2. Snap the origin and destination to their nearest routing node (or
 *    nearest point on a routing edge if between nodes).
 * 3. Run A* (heuristic = Haversine distance to goal) from start → end.
 *    A* visits fewer nodes than Dijkstra for geographic graphs, giving
 *    faster results on larger campus networks.
 * 4. Return the ordered [lat, lng] path + total distance.
 *
 * Falls back to a straight-line route if:
 *  - No routing data is loaded yet
 *  - Start or end can't be snapped within SNAP_LIMIT_M metres
 *  - The graph is not connected between start and end
 *
 * Exports
 * ───────
 *  calculateCampusRoute(from, to, options?) → RouteResult
 *  getDistanceMeters(a, b)                 → number
 */

import { CAMPUS_MAP_DATA } from "./campus-data";

// ─── TYPES ────────────────────────────────────────────────────────────────────
// RouteResult: { points: [lat,lng][], distance: number|null, routed: boolean, reason: string }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M  = 6_371_000;
const SNAP_LIMIT_M    = 200;   // max metres to snap an origin/dest to the graph
const CONNECT_LIMIT_M = 8;     // auto-connect nodes within this distance (handles float imprecision)

// ─── HAVERSINE ────────────────────────────────────────────────────────────────

export function getDistanceMeters(a, b) {
  const [lat1, lng1] = normalizePoint(a);
  const [lat2, lng2] = normalizePoint(b);
  if (!isFinite(lat1) || !isFinite(lat2)) return Infinity;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ─── COORDINATE HELPERS ───────────────────────────────────────────────────────

function normalizePoint(p) {
  if (Array.isArray(p))             return [Number(p[0]),   Number(p[1])];
  if (p && typeof p === "object")   return [Number(p.lat ?? p[0]), Number(p.lng ?? p[1])];
  return [NaN, NaN];
}

function isValidPoint([lat, lng]) {
  return isFinite(lat) && isFinite(lng);
}

function pointKey([lat, lng]) {
  return `${lat.toFixed(7)},${lng.toFixed(7)}`;
}

// ─── MIN-HEAP (priority queue) ────────────────────────────────────────────────

class MinHeap {
  constructor() { this._heap = []; }

  push(item) {
    this._heap.push(item);
    this._bubbleUp(this._heap.length - 1);
  }

  pop() {
    const top  = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() { return this._heap.length; }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._heap[parent].priority <= this._heap[i].priority) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._heap[l].priority < this._heap[min].priority) min = l;
      if (r < n && this._heap[r].priority < this._heap[min].priority) min = r;
      if (min === i) break;
      [this._heap[min], this._heap[i]] = [this._heap[i], this._heap[min]];
      i = min;
    }
  }
}

// ─── GRAPH ────────────────────────────────────────────────────────────────────

/**
 * Build a weighted adjacency graph from routing_nodes + routing_edges.
 * Falls back to building from visual paths if no routing data exists.
 */
function buildGraph() {
  const nodes = new Map(); // key → { key, point: [lat,lng], neighbours: Map<key, dist> }

  function ensureNode(key, point) {
    if (!nodes.has(key)) nodes.set(key, { key, point, neighbours: new Map() });
    return nodes.get(key);
  }

  function linkNodes(keyA, pointA, keyB, pointB) {
    const dist = getDistanceMeters(pointA, pointB);
    if (!isFinite(dist) || dist <= 0) return;
    const a = ensureNode(keyA, pointA);
    const b = ensureNode(keyB, pointB);
    // bidirectional — take shorter distance if duplicate
    if (!a.neighbours.has(keyB) || dist < a.neighbours.get(keyB)) a.neighbours.set(keyB, dist);
    if (!b.neighbours.has(keyA) || dist < b.neighbours.get(keyA)) b.neighbours.set(keyA, dist);
  }

  const routingNodes = CAMPUS_MAP_DATA.routingNodes ?? [];
  const routingEdges = CAMPUS_MAP_DATA.routingEdges ?? [];

  if (routingNodes.length > 0 && routingEdges.length > 0) {
    // ── Primary path: use explicit routing graph from QGIS ──────────────
    const nodeById = new Map();
    routingNodes.forEach((n) => {
      if (!isFinite(n.lat) || !isFinite(n.lng)) return;
      const pt  = [n.lat, n.lng];
      const key = pointKey(pt);
      nodeById.set(n.id, { key, point: pt });
      ensureNode(key, pt);
    });

    routingEdges.forEach((e) => {
      const a = nodeById.get(e.from_node);
      const b = nodeById.get(e.to_node);
      if (!a || !b) return;
      linkNodes(a.key, a.point, b.key, b.point);
    });
  } else {
    // ── Fallback: derive graph from visual path polylines ────────────────
    (CAMPUS_MAP_DATA.paths ?? []).forEach((path) => {
      const pts = (path.points ?? [])
        .map(normalizePoint)
        .filter(isValidPoint);
      for (let i = 1; i < pts.length; i++) {
        linkNodes(pointKey(pts[i - 1]), pts[i - 1], pointKey(pts[i]), pts[i]);
      }
    });
  }

  // Auto-connect nodes within CONNECT_LIMIT_M (handles minor snapping gaps)
  const arr = Array.from(nodes.values());
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const d = getDistanceMeters(arr[i].point, arr[j].point);
      if (d > 0 && d <= CONNECT_LIMIT_M) {
        linkNodes(arr[i].key, arr[i].point, arr[j].key, arr[j].point);
      }
    }
  }

  return nodes;
}

// ─── SNAPPING ────────────────────────────────────────────────────────────────

/**
 * Snap an arbitrary point to the nearest node in the graph.
 * Returns { key, point, distance } or null if outside SNAP_LIMIT_M.
 */
function snapToGraph(graph, point) {
  let best     = null;
  let bestDist = Infinity;

  graph.forEach((node) => {
    const d = getDistanceMeters(point, node.point);
    if (d < bestDist) { bestDist = d; best = node; }
  });

  if (!best || bestDist > SNAP_LIMIT_M) return null;
  return { key: best.key, point: best.point, distance: bestDist };
}

// ─── A* ───────────────────────────────────────────────────────────────────────

function aStar(graph, startKey, endKey, endPoint) {
  const gScore = new Map();   // best known cost from start
  const fScore = new Map();   // gScore + heuristic
  const prev   = new Map();
  const closed = new Set();
  const open   = new MinHeap();

  graph.forEach((_, key) => { gScore.set(key, Infinity); fScore.set(key, Infinity); });
  gScore.set(startKey, 0);
  fScore.set(startKey, getDistanceMeters(graph.get(startKey).point, endPoint));
  open.push({ priority: fScore.get(startKey), key: startKey });

  while (open.size > 0) {
    const { key: current } = open.pop();
    if (current === endKey) break;
    if (closed.has(current)) continue;
    closed.add(current);

    const node = graph.get(current);
    if (!node) continue;

    node.neighbours.forEach((edgeDist, neighbourKey) => {
      if (closed.has(neighbourKey)) return;
      const tentative = gScore.get(current) + edgeDist;
      if (tentative < (gScore.get(neighbourKey) ?? Infinity)) {
        prev.set(neighbourKey, current);
        gScore.set(neighbourKey, tentative);
        const h = getDistanceMeters(graph.get(neighbourKey)?.point ?? endPoint, endPoint);
        const f = tentative + h;
        fScore.set(neighbourKey, f);
        open.push({ priority: f, key: neighbourKey });
      }
    });
  }

  if (!prev.has(endKey) && startKey !== endKey) return null;

  // Reconstruct path
  const path = [];
  let cursor = endKey;
  while (cursor !== undefined) {
    path.unshift(graph.get(cursor).point);
    cursor = prev.get(cursor);
  }
  return path;
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function routeDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += getDistanceMeters(points[i - 1], points[i]);
  return total;
}

function straight(from, to, reason) {
  const pts = [from, to];
  return { points: pts, distance: routeDistance(pts), routed: false, reason };
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * @param {{ lat: number, lng: number } | [number, number]} fromInput
 * @param {{ lat: number, lng: number } | [number, number]} toInput
 * @param {{ mode?: "walk" | "drive" }} [options]
 * @returns {{ points: [number,number][], distance: number|null, routed: boolean, reason: string }}
 */
export function calculateCampusRoute(fromInput, toInput, options = {}) {
  const from = normalizePoint(fromInput);
  const to   = normalizePoint(toInput);

  if (!isValidPoint(from) || !isValidPoint(to)) {
    return { points: [], distance: null, routed: false, reason: "Invalid coordinates" };
  }

  // Trivially close — no route needed
  if (getDistanceMeters(from, to) < 5) {
    return { points: [from, to], distance: 0, routed: true, reason: "Same location" };
  }

  const graph = buildGraph();

  if (graph.size === 0) {
    return straight(from, to, "No routing data loaded yet");
  }

  const startSnap = snapToGraph(graph, from);
  const endSnap   = snapToGraph(graph, to);

  if (!startSnap) return straight(from, to, "Origin is too far from any campus path");
  if (!endSnap)   return straight(from, to, "Destination is too far from any campus path");

  // Same snapped node — straight shot
  if (startSnap.key === endSnap.key) {
    const pts = [from, startSnap.point, to];
    return { points: pts, distance: routeDistance(pts), routed: true, reason: "Single node" };
  }

  const path = aStar(graph, startSnap.key, endSnap.key, endSnap.point);

  if (!path || path.length === 0) {
    return straight(from, to, "No connected path found between these points");
  }

  // Prepend exact origin, append exact dest so the line starts/ends at the real location
  const points = [from, ...path, to];
  return {
    points,
    distance: routeDistance(points),
    routed:   true,
    reason:   "Campus route",
  };
}
