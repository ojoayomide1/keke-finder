import {
  CAMPUS_CATEGORY_META,
  CAMPUS_EDITOR_MODE,
  getCampusCategoryMeta,
  getCampusMapData,
  saveCampusDataToFirestore
} from "./campus-data.js";

const SNAP_DISTANCE_M = 12;
const PREVIEW_SNAP_DISTANCE_M = 180;

const campusDraft = {
  locations: [],
  rideStops: [],
  paths: [],
  buildings: [],
  indoorLocations: []
};

let activePathDraft = [];
let activeBuildingDraft = [];
let routePreviewDraft = [];
let campusDraftLayers = [];
let campusDraftHistory = [];
let activeShapeLayer = null;
let graphNodeLayer = null;
let routePreviewLayer = null;
let currentLocationLayer = null;
let campusEditorLocationWatchId = null;
let lastEditorLocation = null;
let hasCenteredEditorLocation = false;
let map = null;
let clickHandler = null;
let editorDragState = null;

function getCampusEditorElements() {
  return {
    panel: document.getElementById("campusEditor"),
    nameInput: document.getElementById("campusPointName"),
    typeInput: document.getElementById("campusPointType"),
    categoryInput: document.getElementById("campusPointCategory"),
    hint: document.getElementById("campusEditorHint"),
    output: document.getElementById("campusEditorOutput"),
    copyBtn: document.getElementById("copyCampusJsonBtn"),
    saveCloudBtn: document.getElementById("saveCampusCloudBtn"),
    undoBtn: document.getElementById("undoCampusDraftBtn"),
    saveShapeBtn: document.getElementById("saveCampusShapeBtn"),
    clearBtn: document.getElementById("clearCampusDraftBtn"),
    clearPreviewBtn: document.getElementById("clearCampusPreviewBtn"),
    locateBtn: document.getElementById("locateCampusEditorBtn"),
    minimizeBtn: document.getElementById("minimizeCampusEditorBtn"),
    graphStatus: document.getElementById("campusGraphStatus"),
    header: document.querySelector("#campusEditor .campus-editor__header")
  };
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unnamed";
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function getDistanceMeters(from, to) {
  if (!from || !to) return Infinity;
  const earthRadius = 6371e3;
  const fromLat = from[0] * Math.PI / 180;
  const toLat = to[0] * Math.PI / 180;
  const deltaLat = (to[0] - from[0]) * Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function formatCampusDraft() {
  return JSON.stringify(campusDraft, null, 2);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDraftCount() {
  return campusDraft.locations.length +
    campusDraft.rideStops.length +
    campusDraft.paths.length +
    campusDraft.buildings.length +
    campusDraft.indoorLocations.length;
}

function mergedCampusData() {
  const current = getCampusMapData();
  return {
    locations: [...clone(current.locations), ...clone(campusDraft.locations)],
    rideStops: [...clone(current.rideStops), ...clone(campusDraft.rideStops)],
    paths: [...clone(current.paths), ...clone(campusDraft.paths)],
    buildings: [...clone(current.buildings), ...clone(campusDraft.buildings)],
    indoorLocations: [...clone(current.indoorLocations), ...clone(campusDraft.indoorLocations)]
  };
}

function pointKey(point) {
  return `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`;
}

function buildEditorGraph(data = mergedCampusData()) {
  const nodes = new Map();
  const nodePoints = new Map();
  let segmentCount = 0;

  const ensureNode = (point) => {
    const key = pointKey(point);
    if (!nodes.has(key)) {
      nodes.set(key, new Set());
      nodePoints.set(key, point);
    }
    return key;
  };

  data.paths.forEach(path => {
    const points = Array.isArray(path.points)
      ? path.points.filter(point => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))
      : [];

    for (let i = 1; i < points.length; i += 1) {
      const fromKey = ensureNode(points[i - 1]);
      const toKey = ensureNode(points[i]);
      nodes.get(fromKey).add(toKey);
      nodes.get(toKey).add(fromKey);
      segmentCount += 1;
    }
  });

  const nodeKeys = Array.from(nodes.keys());
  for (let i = 0; i < nodeKeys.length; i += 1) {
    for (let j = i + 1; j < nodeKeys.length; j += 1) {
      const fromKey = nodeKeys[i];
      const toKey = nodeKeys[j];
      if (getDistanceMeters(nodePoints.get(fromKey), nodePoints.get(toKey)) <= 10) {
        nodes.get(fromKey).add(toKey);
        nodes.get(toKey).add(fromKey);
      }
    }
  }

  return { nodes, nodePoints, segmentCount };
}

function getGraphDiagnostics() {
  const { nodes, segmentCount } = buildEditorGraph();
  const visited = new Set();
  let components = 0;
  nodes.forEach((_, startKey) => {
    if (visited.has(startKey)) return;
    components += 1;
    const stack = [startKey];
    visited.add(startKey);

    while (stack.length > 0) {
      const key = stack.pop();
      nodes.get(key)?.forEach(nextKey => {
        if (visited.has(nextKey)) return;
        visited.add(nextKey);
        stack.push(nextKey);
      });
    }
  });

  return {
    nodes: nodes.size,
    segments: segmentCount,
    components,
    draftCount: getDraftCount()
  };
}

function findNearestGraphNode(point, limitMeters = SNAP_DISTANCE_M) {
  const { nodePoints } = buildEditorGraph();
  let nearest = null;
  let nearestDistance = Infinity;

  nodePoints.forEach((nodePoint) => {
    const distance = getDistanceMeters(point, nodePoint);
    if (distance < nearestDistance) {
      nearest = nodePoint;
      nearestDistance = distance;
    }
  });

  if (!nearest || nearestDistance > limitMeters) {
    return { point, snapped: false, distance: nearestDistance };
  }

  return { point: nearest, snapped: true, distance: nearestDistance };
}

function getSnappedPoint(point, limitMeters = SNAP_DISTANCE_M) {
  const snapped = findNearestGraphNode(point, limitMeters);
  return [
    roundCoord(snapped.point[0]),
    roundCoord(snapped.point[1])
  ];
}

function findNearestNodeInGraph(graph, point) {
  let nearestKey = null;
  let nearestPoint = null;
  let nearestDistance = Infinity;

  graph.nodePoints.forEach((nodePoint, key) => {
    const distance = getDistanceMeters(point, nodePoint);
    if (distance < nearestDistance) {
      nearestKey = key;
      nearestPoint = nodePoint;
      nearestDistance = distance;
    }
  });

  return { key: nearestKey, point: nearestPoint, distance: nearestDistance };
}

function findEditorShortestPath(graph, startKey, endKey) {
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
    const currentPoint = graph.nodePoints.get(currentKey);
    graph.nodes.get(currentKey)?.forEach(neighborKey => {
      if (!unvisited.has(neighborKey)) return;
      const edgeDistance = getDistanceMeters(currentPoint, graph.nodePoints.get(neighborKey));
      const nextDistance = currentDistance + edgeDistance;
      if (nextDistance < distances.get(neighborKey)) {
        distances.set(neighborKey, nextDistance);
        previous.set(neighborKey, currentKey);
      }
    });
  }

  if (startKey !== endKey && !previous.has(endKey)) return null;

  const keys = [endKey];
  let cursor = endKey;
  while (cursor !== startKey) {
    cursor = previous.get(cursor);
    if (!cursor) return null;
    keys.unshift(cursor);
  }

  return keys.map(key => graph.nodePoints.get(key));
}

function calculateEditorRoute(from, to) {
  const graph = buildEditorGraph();
  if (graph.nodes.size === 0) {
    return { points: [from, to], routed: false, reason: "No route paths mapped yet" };
  }

  const start = findNearestNodeInGraph(graph, from);
  const end = findNearestNodeInGraph(graph, to);
  if (!start.key || !end.key) {
    return { points: [from, to], routed: false, reason: "No nearby route node found" };
  }

  if (start.distance > PREVIEW_SNAP_DISTANCE_M || end.distance > PREVIEW_SNAP_DISTANCE_M) {
    return { points: [from, to], routed: false, reason: "Preview point is too far from the route network" };
  }

  const path = findEditorShortestPath(graph, start.key, end.key);
  if (!path) {
    return { points: [from, to], routed: false, reason: "Route paths are not connected" };
  }

  return { points: [from, ...path, to], routed: true, reason: "Preview route" };
}

function drawRoutePreview() {
  const elements = getCampusEditorElements();
  if (routePreviewLayer) {
    map.removeLayer(routePreviewLayer);
    routePreviewLayer = null;
  }

  if (routePreviewDraft.length === 0) return "";

  const layers = routePreviewDraft.map((point, index) => L.circleMarker(point, {
    radius: 6,
    color: index === 0 ? "#2563eb" : "#db2777",
    fillColor: index === 0 ? "#bfdbfe" : "#fbcfe8",
    fillOpacity: 0.95,
    weight: 2
  }).bindTooltip(index === 0 ? "Preview start" : "Preview end"));

  if (routePreviewDraft.length === 2) {
    const route = calculateEditorRoute(routePreviewDraft[0], routePreviewDraft[1]);
    layers.push(L.polyline(route.points, {
      color: "#2563eb",
      weight: 5,
      opacity: 0.82,
      dashArray: route.routed ? null : "8, 10",
      lineCap: "round",
      lineJoin: "round"
    }));
    if (elements.hint) elements.hint.innerText = route.reason;
    routePreviewLayer = L.layerGroup(layers).addTo(map);
    return route.reason;
  } else if (elements.hint) {
    elements.hint.innerText = "Choose preview endpoint.";
  }

  routePreviewLayer = L.layerGroup(layers).addTo(map);
  return "Choose preview endpoint.";
}

function updateGraphStatus() {
  const { graphStatus } = getCampusEditorElements();
  if (!graphStatus) return;

  const diagnostics = getGraphDiagnostics();
  graphStatus.classList.remove("warning", "good");

  if (diagnostics.segments === 0) {
    graphStatus.classList.add("warning");
    graphStatus.innerText = "No routable paths mapped yet. Routes will fall back to direct lines.";
    return;
  }

  if (diagnostics.components > 1) {
    graphStatus.classList.add("warning");
    graphStatus.innerText = `${diagnostics.segments} path segments / ${diagnostics.components} disconnected networks. Join path endpoints for reliable routing.`;
    return;
  }

  graphStatus.classList.add("good");
  graphStatus.innerText = `${diagnostics.segments} path segments / ${diagnostics.nodes} graph nodes / connected route network.`;
}

function updateGraphNodeLayer() {
  if (!map) return;
  if (graphNodeLayer) {
    map.removeLayer(graphNodeLayer);
    graphNodeLayer = null;
  }

  const { nodes, nodePoints } = buildEditorGraph();
  graphNodeLayer = L.layerGroup();

  nodePoints.forEach((point, key) => {
    const degree = nodes.get(key)?.size || 0;
    const isEndpoint = degree <= 1;
    const marker = L.circleMarker(point, {
      radius: isEndpoint ? 5 : 3,
      color: isEndpoint ? "#ea580c" : "#16a34a",
      fillColor: isEndpoint ? "#fed7aa" : "#bbf7d0",
      fillOpacity: 0.9,
      weight: 2,
      pane: "markerPane"
    }).bindTooltip(isEndpoint ? "Route endpoint" : "Route connection", {
      direction: "top",
      opacity: 0.9
    });
    graphNodeLayer.addLayer(marker);
  });

  graphNodeLayer.addTo(map);
}

function updateCampusEditorOutput() {
  const { output, hint } = getCampusEditorElements();
  if (!output) return;

  output.value = formatCampusDraft();

  if (hint) {
    hint.innerText = [
      `${campusDraft.locations.length} markers`,
      `${campusDraft.rideStops.length} ride stops`,
      `${campusDraft.paths.length} roads`,
      `${campusDraft.buildings.length} buildings`
    ].join(" / ");
  }

  updateGraphStatus();
  updateGraphNodeLayer();
}

function addCampusDraftLayer(layer, action = null) {
  campusDraftLayers.push(layer);
  layer.addTo(map);
  if (action) campusDraftHistory.push({ ...action, layer });
}

function clearActiveShapeLayer() {
  if (activeShapeLayer) {
    map.removeLayer(activeShapeLayer);
    activeShapeLayer = null;
  }
}

function clearRoutePreview() {
  routePreviewDraft = [];
  if (routePreviewLayer) {
    map.removeLayer(routePreviewLayer);
    routePreviewLayer = null;
  }
  updateCampusEditorOutput();
}

function drawActiveShape(type, points) {
  clearActiveShapeLayer();

  if (points.length === 0) return;

  if (points.length === 1) {
    activeShapeLayer = L.circleMarker(points[0], {
      radius: 4,
      color: "#9ca3af"
    }).addTo(map);
    return;
  }

  activeShapeLayer = type === "path"
    ? L.polyline(points, { color: "#9ca3af", weight: 2, opacity: 0.72 }).addTo(map)
    : L.polygon(points, {
        color: "#9ca3af",
        fillColor: "#c7ccd4",
        fillOpacity: 0.45,
        weight: 2
      }).addTo(map);
}

function clearCampusDraft() {
  campusDraft.locations = [];
  campusDraft.rideStops = [];
  campusDraft.paths = [];
  campusDraft.buildings = [];
  campusDraft.indoorLocations = [];
  activePathDraft = [];
  activeBuildingDraft = [];
  routePreviewDraft = [];
  campusDraftHistory = [];

  clearActiveShapeLayer();
  if (routePreviewLayer) {
    map.removeLayer(routePreviewLayer);
    routePreviewLayer = null;
  }
  campusDraftLayers.forEach(layer => map.removeLayer(layer));
  campusDraftLayers = [];
  updateCampusEditorOutput();
}

function saveCampusLine(type, name, points) {
  const minimumPoints = type === "building" ? 3 : 2;
  if (points.length < minimumPoints) return;

  const entry = {
    id: slugify(name),
    name,
    points: [...points]
  };

  if (type === "path") {
    campusDraft.paths.push(entry);
    addCampusDraftLayer(L.polyline(points, {
      color: "#9ca3af",
      weight: 2,
      opacity: 0.72,
      lineCap: "round"
    }), { collection: "paths", index: campusDraft.paths.length - 1 });
  } else {
    campusDraft.buildings.push(entry);
    addCampusDraftLayer(L.polygon(points, {
      color: "#9ca3af",
      fillColor: "#c7ccd4",
      fillOpacity: 0.55,
      weight: 2
    }), { collection: "buildings", index: campusDraft.buildings.length - 1 });
  }
}

function saveActiveCampusShape() {
  const { nameInput, typeInput } = getCampusEditorElements();
  if (!nameInput || !typeInput) return;

  const type = typeInput.value;
  const name = nameInput.value.trim() || "Unnamed";

  if (type === "path") {
    saveCampusLine("path", name, activePathDraft);
    activePathDraft = [];
  }

  if (type === "building") {
    saveCampusLine("building", name, activeBuildingDraft);
    activeBuildingDraft = [];
  }

  clearActiveShapeLayer();
  updateCampusEditorOutput();
}

function undoLastCampusDraftAction() {
  const { typeInput } = getCampusEditorElements();
  if (typeInput?.value === "path" && activePathDraft.length > 0) {
    activePathDraft.pop();
    drawActiveShape("path", activePathDraft);
    updateCampusEditorOutput();
    return;
  }

  if (typeInput?.value === "building" && activeBuildingDraft.length > 0) {
    activeBuildingDraft.pop();
    drawActiveShape("building", activeBuildingDraft);
    updateCampusEditorOutput();
    return;
  }

  const action = campusDraftHistory.pop();
  if (!action) return;

  campusDraft[action.collection]?.splice(action.index, 1);
  campusDraftLayers = campusDraftLayers.filter(layer => layer !== action.layer);
  map.removeLayer(action.layer);

  campusDraftHistory.forEach((item) => {
    if (item.collection === action.collection && item.index > action.index) {
      item.index -= 1;
    }
  });

  updateCampusEditorOutput();
}

async function saveCampusDraftToCloud() {
  const elements = getCampusEditorElements();
  if (activePathDraft.length > 0 || activeBuildingDraft.length > 0) {
    if (elements.hint) elements.hint.innerText = "Save or undo the active shape before saving the map.";
    return;
  }

  if (getDraftCount() === 0) {
    if (elements.hint) elements.hint.innerText = "No draft changes to save.";
    return;
  }

  if (elements.saveCloudBtn) elements.saveCloudBtn.innerText = "Saving...";

  try {
    await saveCampusDataToFirestore(mergedCampusData());
    campusDraft.locations = [];
    campusDraft.rideStops = [];
    campusDraft.paths = [];
    campusDraft.buildings = [];
    campusDraft.indoorLocations = [];
    campusDraftHistory = [];
    campusDraftLayers = [];
    if (elements.hint) elements.hint.innerText = "Campus map saved to cloud.";
    updateCampusEditorOutput();
  } catch (err) {
    console.error("Failed to save campus draft:", err);
    if (elements.hint) elements.hint.innerText = `Save failed: ${err.code || err.message}`;
  } finally {
    if (elements.saveCloudBtn) elements.saveCloudBtn.innerHTML = `<i class="fas fa-cloud-arrow-up"></i> Save map`;
  }
}

function setEditorPosition(panel, left, top) {
  const parentRect = panel.offsetParent?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const rect = panel.getBoundingClientRect();
  const maxLeft = Math.max(8, parentRect.width - rect.width - 8);
  const maxTop = Math.max(8, parentRect.height - rect.height - 8);
  panel.style.left = `${Math.min(Math.max(8, left - parentRect.left), maxLeft)}px`;
  panel.style.top = `${Math.min(Math.max(8, top - parentRect.top), maxTop)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function beginEditorDrag(event) {
  const elements = getCampusEditorElements();
  if (!elements.panel) return;
  if (event.target.closest("button, input, select, textarea")) return;

  const pointer = event.touches?.[0] || event;
  const rect = elements.panel.getBoundingClientRect();
  editorDragState = {
    offsetX: pointer.clientX - rect.left,
    offsetY: pointer.clientY - rect.top
  };
  elements.panel.classList.add("campus-editor--dragging");
  document.addEventListener("mousemove", moveEditorDrag);
  document.addEventListener("mouseup", endEditorDrag);
  document.addEventListener("touchmove", moveEditorDrag, { passive: false });
  document.addEventListener("touchend", endEditorDrag);
}

function moveEditorDrag(event) {
  if (!editorDragState) return;
  event.preventDefault();
  const elements = getCampusEditorElements();
  if (!elements.panel) return;
  const pointer = event.touches?.[0] || event;
  setEditorPosition(
    elements.panel,
    pointer.clientX - editorDragState.offsetX,
    pointer.clientY - editorDragState.offsetY
  );
}

function endEditorDrag() {
  const elements = getCampusEditorElements();
  elements.panel?.classList.remove("campus-editor--dragging");
  editorDragState = null;
  document.removeEventListener("mousemove", moveEditorDrag);
  document.removeEventListener("mouseup", endEditorDrag);
  document.removeEventListener("touchmove", moveEditorDrag);
  document.removeEventListener("touchend", endEditorDrag);
}

function toggleEditorMinimized() {
  const elements = getCampusEditorElements();
  if (!elements.panel || !elements.minimizeBtn) return;
  const minimized = elements.panel.classList.toggle("campus-editor--minimized");
  elements.minimizeBtn.innerHTML = `<i class="fas ${minimized ? "fa-up-right-and-down-left-from-center" : "fa-minus"}"></i>`;
  elements.minimizeBtn.setAttribute("aria-label", minimized ? "Expand editor" : "Minimize editor");
  setTimeout(() => map?.invalidateSize(), 100);
}

function updateLocateButton(isTracking) {
  const { locateBtn } = getCampusEditorElements();
  if (!locateBtn) return;
  locateBtn.classList.toggle("active", isTracking);
  locateBtn.setAttribute("aria-label", isTracking ? "Stop live location tracking" : "Track my location");
  locateBtn.innerHTML = `<i class="fas ${isTracking ? "fa-location-dot" : "fa-location-crosshairs"}"></i>`;
}

export function stopCampusEditorLocationWatch() {
  if (campusEditorLocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(campusEditorLocationWatchId);
  }
  campusEditorLocationWatchId = null;
  lastEditorLocation = null;
  hasCenteredEditorLocation = false;
  updateLocateButton(false);
}

function updateCurrentLocation(pos, watchId) {
  if (campusEditorLocationWatchId !== watchId || !map) return;

  const elements = getCampusEditorElements();
  const { latitude, longitude, accuracy } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const precisePoint = [latitude, longitude];
  const point = [
    roundCoord(latitude),
    roundCoord(longitude)
  ];
  const distanceMoved = getDistanceMeters(lastEditorLocation, precisePoint);
  if (distanceMoved < 2 && currentLocationLayer) return;
  lastEditorLocation = precisePoint;

  if (currentLocationLayer) {
    currentLocationLayer.setLatLng(point);
  } else {
    currentLocationLayer = L.circleMarker(point, {
      radius: 8,
      color: "#2563eb",
      fillColor: "#2563eb",
      fillOpacity: 0.85,
      weight: 3
    }).addTo(map).bindPopup("Your live location");
  }

  if (!hasCenteredEditorLocation) {
    map.setView(point, Math.max(map.getZoom(), 18));
    currentLocationLayer.openPopup();
    hasCenteredEditorLocation = true;
  } else {
    map.panTo(point, { animate: true, duration: 0.7 });
  }

  if (elements.hint) {
    const accuracyText = Number.isFinite(accuracy) ? ` / ${Math.round(accuracy)}m accuracy` : "";
    elements.hint.innerText = `Live location: ${point[0]}, ${point[1]}${accuracyText}`;
  }
}

function toggleCurrentLocationTracking() {
  const elements = getCampusEditorElements();
  if (campusEditorLocationWatchId !== null) {
    stopCampusEditorLocationWatch();
    if (elements.hint) elements.hint.innerText = "Live location tracking stopped.";
    return;
  }

  if (!navigator.geolocation) {
    if (elements.hint) elements.hint.innerText = "Location is not available on this device.";
    return;
  }

  if (elements.hint) elements.hint.innerText = "Starting live location tracking...";
  hasCenteredEditorLocation = false;
  let watchId = null;
  watchId = navigator.geolocation.watchPosition((pos) => {
    updateCurrentLocation(pos, watchId);
  }, (err) => {
    if (campusEditorLocationWatchId !== watchId) return;
    stopCampusEditorLocationWatch();
    if (elements.hint) elements.hint.innerText = `Location unavailable: ${err.message}`;
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
  campusEditorLocationWatchId = watchId;
  updateLocateButton(true);
}

function captureCampusPoint(event) {
  const { nameInput, typeInput } = getCampusEditorElements();
  if (!nameInput || !typeInput) return;

  const name = nameInput.value.trim() || "Unnamed";
  let point = [
    roundCoord(event.latlng.lat),
    roundCoord(event.latlng.lng)
  ];
  const rawPoint = [...point];
  let hintMessage = "";

  if (typeInput.value === "location") {
    const category = getCampusEditorElements().categoryInput?.value || "service";
    const location = {
      id: slugify(name),
      name,
      category,
      lat: point[0],
      lng: point[1]
    };

    campusDraft.locations.push(location);
    const meta = getCampusCategoryMeta(category);
    addCampusDraftLayer(
      L.marker(point).bindPopup(`${name}<br>${meta.label}<br>${point[0]}, ${point[1]}`),
      { collection: "locations", index: campusDraft.locations.length - 1 }
    );
  }
  if (typeInput.value === "rideStop") {
    const stop = {
      id: slugify(name),
      name,
      type: "pickup_dropoff",
      lat: point[0],
      lng: point[1],
      serves: []
    };

    campusDraft.rideStops.push(stop);
    addCampusDraftLayer(
      L.marker(point).bindPopup(`${name}<br>Pickup / drop-off<br>${point[0]}, ${point[1]}`),
      { collection: "rideStops", index: campusDraft.rideStops.length - 1 }
    );
  }

  if (typeInput.value === "path") {
    const snapped = findNearestGraphNode(point, SNAP_DISTANCE_M);
    point = [
      roundCoord(snapped.point[0]),
      roundCoord(snapped.point[1])
    ];
    activePathDraft.push(point);
    drawActiveShape("path", activePathDraft);
    if (snapped.snapped) {
      hintMessage = `Snapped to route node ${Math.round(snapped.distance)}m away.`;
    }
  }

  if (typeInput.value === "building") {
    activeBuildingDraft.push(point);
    drawActiveShape("building", activeBuildingDraft);
  }

  if (typeInput.value === "routePreview") {
    routePreviewDraft.push(getSnappedPoint(rawPoint, PREVIEW_SNAP_DISTANCE_M));
    if (routePreviewDraft.length > 2) {
      routePreviewDraft = [routePreviewDraft[routePreviewDraft.length - 1]];
    }
    hintMessage = drawRoutePreview();
  }

  updateCampusEditorOutput();
  if (hintMessage) {
    const { hint } = getCampusEditorElements();
    if (hint) hint.innerText = hintMessage;
  }
}

export function initCampusEditor(nextMap, options = {}) {
  if (map && map !== nextMap) {
    stopCampusEditorLocationWatch();
    currentLocationLayer = null;
  }
  map = nextMap;
  const elements = getCampusEditorElements();
  if (!elements.panel || !map) return;

  const enabled = CAMPUS_EDITOR_MODE && options.enabled;
  elements.panel.classList.toggle("hidden", !enabled);
  if (!enabled) {
    stopCampusEditorLocationWatch();
    return;
  }

  updateCampusEditorOutput();

  if (elements.categoryInput) {
    elements.categoryInput.innerHTML = Object.entries(CAMPUS_CATEGORY_META)
      .filter(([key]) => key !== "pickup")
      .map(([key, meta]) => `<option value="${key}">${meta.label}</option>`)
      .join("");
  }

  const syncCategoryVisibility = () => {
    if (!elements.categoryInput) return;
    elements.categoryInput.disabled = elements.typeInput?.value !== "location";
  };
  elements.typeInput?.addEventListener("change", syncCategoryVisibility);
  syncCategoryVisibility();
  if (clickHandler) map.off("click", clickHandler);
  clickHandler = captureCampusPoint;
  map.on("click", clickHandler);

  if (elements.clearBtn) elements.clearBtn.onclick = clearCampusDraft;
  if (elements.clearPreviewBtn) elements.clearPreviewBtn.onclick = clearRoutePreview;
  if (elements.undoBtn) elements.undoBtn.onclick = undoLastCampusDraftAction;
  if (elements.saveShapeBtn) elements.saveShapeBtn.onclick = saveActiveCampusShape;
  if (elements.saveCloudBtn) elements.saveCloudBtn.onclick = saveCampusDraftToCloud;
  if (elements.locateBtn) elements.locateBtn.onclick = toggleCurrentLocationTracking;
  if (elements.minimizeBtn) elements.minimizeBtn.onclick = toggleEditorMinimized;
  elements.header?.addEventListener("mousedown", beginEditorDrag);
  elements.header?.addEventListener("touchstart", beginEditorDrag, { passive: true });
  if (!elements.copyBtn) return;
  elements.copyBtn.onclick = async () => {
    const json = formatCampusDraft();

    try {
      await navigator.clipboard.writeText(json);
      elements.copyBtn.innerText = "Copied";
      setTimeout(() => {
        elements.copyBtn.innerText = "Copy JSON";
      }, 1200);
    } catch {
      elements.output.select();
    }
  };
}
