import { getCampusMapData } from "../campus-data.js";

const EARTH_RADIUS_M = 6371e3;
const CONNECT_TOLERANCE_M = 10;
const SNAP_DISTANCE_LIMIT_M = 180;

function normalizePoint(point) {
  if (Array.isArray(point)) {
    return [Number(point[0]), Number(point[1])];
  }

  if (point && typeof point === "object") {
    return [Number(point.lat), Number(point.lng)];
  }

  return [NaN, NaN];
}

function isValidPoint(point) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function pointKey(point) {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

export function getDistanceMeters(a, b) {
  const from = normalizePoint(a);
  const to = normalizePoint(b);
  if (!isValidPoint(from) || !isValidPoint(to)) return Infinity;

  const fromLat = from[0] * Math.PI / 180;
  const toLat = to[0] * Math.PI / 180;
  const deltaLat = (to[0] - from[0]) * Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * Math.PI / 180;
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) *
    Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

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

  const currentForward = fromNode.edges.get(toNode.key);
  const currentBackward = toNode.edges.get(fromNode.key);
  if (currentForward == null || distance < currentForward) fromNode.edges.set(toNode.key, distance);
  if (currentBackward == null || distance < currentBackward) toNode.edges.set(fromNode.key, distance);
}

function buildCampusGraph() {
  const graph = { nodes: new Map() };
  const data = getCampusMapData();

  data.paths.forEach(path => {
    const points = Array.isArray(path.points)
      ? path.points.map(normalizePoint).filter(isValidPoint)
      : [];

    for (let i = 1; i < points.length; i += 1) {
      const fromNode = addNode(graph, points[i - 1]);
      const toNode = addNode(graph, points[i]);
      addEdge(fromNode, toNode);
    }
  });

  const nodes = Array.from(graph.nodes.values());
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (getDistanceMeters(nodes[i].point, nodes[j].point) <= CONNECT_TOLERANCE_M) {
        addEdge(nodes[i], nodes[j]);
      }
    }
  }

  return graph;
}

function findNearestNode(graph, point) {
  let nearest = null;
  let nearestDistance = Infinity;

  graph.nodes.forEach(node => {
    const distance = getDistanceMeters(point, node.point);
    if (distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  });

  return { node: nearest, distance: nearestDistance };
}

function findShortestPath(graph, startKey, endKey) {
  const distances = new Map();
  const previous = new Map();
  const unvisited = new Set(graph.nodes.keys());

  graph.nodes.forEach((_, key) => distances.set(key, Infinity));
  distances.set(startKey, 0);

  while (unvisited.size > 0) {
    let currentKey = null;
    let currentDistance = Infinity;

    unvisited.forEach(key => {
      const distance = distances.get(key);
      if (distance < currentDistance) {
        currentKey = key;
        currentDistance = distance;
      }
    });

    if (currentKey == null || currentDistance === Infinity) break;
    if (currentKey === endKey) break;

    unvisited.delete(currentKey);
    const currentNode = graph.nodes.get(currentKey);
    currentNode.edges.forEach((edgeDistance, neighborKey) => {
      if (!unvisited.has(neighborKey)) return;
      const nextDistance = currentDistance + edgeDistance;
      if (nextDistance < distances.get(neighborKey)) {
        distances.set(neighborKey, nextDistance);
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

  return path.map(key => graph.nodes.get(key).point);
}

function routeDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += getDistanceMeters(points[i - 1], points[i]);
  }
  return total;
}

function directRoute(from, to, reason) {
  const points = [from, to];
  return {
    points,
    distance: routeDistance(points),
    routed: false,
    reason
  };
}

export function calculateCampusRoute(fromInput, toInput) {
  const from = normalizePoint(fromInput);
  const to = normalizePoint(toInput);

  if (!isValidPoint(from) || !isValidPoint(to)) {
    return { points: [], distance: null, routed: false, reason: "Invalid route coordinates" };
  }

  const graph = buildCampusGraph();
  if (graph.nodes.size === 0) {
    return directRoute(from, to, "No campus paths mapped yet");
  }

  const start = findNearestNode(graph, from);
  const end = findNearestNode(graph, to);

  if (!start.node || !end.node) {
    return directRoute(from, to, "No nearby campus path found");
  }

  if (start.distance > SNAP_DISTANCE_LIMIT_M || end.distance > SNAP_DISTANCE_LIMIT_M) {
    return directRoute(from, to, "Nearest campus path is too far away");
  }

  const path = findShortestPath(graph, start.node.key, end.node.key);
  if (!path || path.length === 0) {
    return directRoute(from, to, "Campus paths are not connected");
  }

  const points = [from, ...path, to];
  return {
    points,
    distance: routeDistance(points),
    routed: true,
    reason: "Campus path route"
  };
}
