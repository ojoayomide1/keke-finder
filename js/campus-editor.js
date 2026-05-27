import { CAMPUS_EDITOR_MODE } from "./campus-data.js";

const campusDraft = {
  locations: [],
  paths: [],
  zones: []
};

let activePathDraft = [];
let activeZoneDraft = [];
let campusDraftLayers = [];
let activeShapeLayer = null;
let map = null;
let clickHandler = null;

function getCampusEditorElements() {
  return {
    panel: document.getElementById("campusEditor"),
    nameInput: document.getElementById("campusPointName"),
    typeInput: document.getElementById("campusPointType"),
    hint: document.getElementById("campusEditorHint"),
    output: document.getElementById("campusEditorOutput"),
    copyBtn: document.getElementById("copyCampusJsonBtn"),
    saveShapeBtn: document.getElementById("saveCampusShapeBtn"),
    clearBtn: document.getElementById("clearCampusDraftBtn")
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

function formatCampusDraft() {
  return JSON.stringify(campusDraft, null, 2);
}

function updateCampusEditorOutput() {
  const { output, hint } = getCampusEditorElements();
  if (!output) return;

  output.value = formatCampusDraft();

  if (hint) {
    hint.innerText = [
      `${campusDraft.locations.length} markers`,
      `${campusDraft.paths.length} roads`,
      `${campusDraft.zones.length} zones`
    ].join(" / ");
  }
}

function addCampusDraftLayer(layer) {
  campusDraftLayers.push(layer);
  layer.addTo(map);
}

function clearActiveShapeLayer() {
  if (activeShapeLayer) {
    map.removeLayer(activeShapeLayer);
    activeShapeLayer = null;
  }
}

function drawActiveShape(type, points) {
  clearActiveShapeLayer();

  if (points.length === 0) return;

  if (points.length === 1) {
    activeShapeLayer = L.circleMarker(points[0], {
      radius: 6,
      color: type === "path" ? "#ff5e1a" : "#ffb800"
    }).addTo(map);
    return;
  }

  activeShapeLayer = type === "path"
    ? L.polyline(points, { color: "#ff5e1a", weight: 5, dashArray: "8 8" }).addTo(map)
    : L.polygon(points, {
        color: "#ffb800",
        fillColor: "#ffb800",
        fillOpacity: 0.12,
        weight: 3,
        dashArray: "8 8"
      }).addTo(map);
}

function clearCampusDraft() {
  campusDraft.locations = [];
  campusDraft.paths = [];
  campusDraft.zones = [];
  activePathDraft = [];
  activeZoneDraft = [];

  clearActiveShapeLayer();
  campusDraftLayers.forEach(layer => map.removeLayer(layer));
  campusDraftLayers = [];
  updateCampusEditorOutput();
}

function saveCampusLine(type, name, points) {
  const minimumPoints = type === "zone" ? 3 : 2;
  if (points.length < minimumPoints) return;

  const entry = {
    id: slugify(name),
    name,
    points: [...points]
  };

  if (type === "path") {
    campusDraft.paths.push(entry);
    addCampusDraftLayer(L.polyline(points, { color: "#ff5e1a", weight: 5, lineCap: "round" }));
  } else {
    campusDraft.zones.push(entry);
    addCampusDraftLayer(L.polygon(points, {
      color: "#ffb800",
      fillColor: "#ffb800",
      fillOpacity: 0.16,
      weight: 3
    }));
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

  if (type === "zone") {
    saveCampusLine("zone", name, activeZoneDraft);
    activeZoneDraft = [];
  }

  clearActiveShapeLayer();
  updateCampusEditorOutput();
}

function captureCampusPoint(event) {
  const { nameInput, typeInput } = getCampusEditorElements();
  if (!nameInput || !typeInput) return;

  const name = nameInput.value.trim() || "Unnamed";
  const point = [
    roundCoord(event.latlng.lat),
    roundCoord(event.latlng.lng)
  ];

  if (typeInput.value === "location") {
    const location = {
      id: slugify(name),
      name,
      category: "pickup",
      lat: point[0],
      lng: point[1]
    };

    campusDraft.locations.push(location);
    addCampusDraftLayer(
      L.marker(point).bindPopup(`${name}<br>${point[0]}, ${point[1]}`)
    );
  }

  if (typeInput.value === "path") {
    activePathDraft.push(point);
    drawActiveShape("path", activePathDraft);
  }

  if (typeInput.value === "zone") {
    activeZoneDraft.push(point);
    drawActiveShape("zone", activeZoneDraft);
  }

  updateCampusEditorOutput();
}

export function initCampusEditor(nextMap, options = {}) {
  map = nextMap;
  const elements = getCampusEditorElements();
  if (!elements.panel || !map) return;

  const enabled = CAMPUS_EDITOR_MODE && options.enabled;
  elements.panel.classList.toggle("hidden", !enabled);
  if (!enabled) return;

  updateCampusEditorOutput();
  if (clickHandler) map.off("click", clickHandler);
  clickHandler = captureCampusPoint;
  map.on("click", clickHandler);

  elements.clearBtn.onclick = clearCampusDraft;
  elements.saveShapeBtn.onclick = saveActiveCampusShape;
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
