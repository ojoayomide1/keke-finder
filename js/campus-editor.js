import { CAMPUS_CATEGORY_META, CAMPUS_EDITOR_MODE, getCampusCategoryMeta } from "./campus-data.js";

const campusDraft = {
  locations: [],
  rideStops: [],
  paths: [],
  buildings: [],
  indoorLocations: []
};

let activePathDraft = [];
let activeBuildingDraft = [];
let campusDraftLayers = [];
let activeShapeLayer = null;
let map = null;
let clickHandler = null;

function getCampusEditorElements() {
  return {
    panel: document.getElementById("campusEditor"),
    nameInput: document.getElementById("campusPointName"),
    typeInput: document.getElementById("campusPointType"),
    categoryInput: document.getElementById("campusPointCategory"),
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
      `${campusDraft.rideStops.length} ride stops`,
      `${campusDraft.paths.length} roads`,
      `${campusDraft.buildings.length} buildings`
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
      color: type === "path" ? "#64748b" : "#9ca3af"
    }).addTo(map);
    return;
  }

  activeShapeLayer = type === "path"
    ? L.polyline(points, { color: "#64748b", weight: 5, dashArray: "8 8" }).addTo(map)
    : L.polygon(points, {
        color: "#9ca3af",
        fillColor: "#c7ccd4",
        fillOpacity: 0.45,
        weight: 2,
        dashArray: "8 8"
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

  clearActiveShapeLayer();
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
    addCampusDraftLayer(L.polyline(points, { color: "#64748b", weight: 5, lineCap: "round" }));
  } else {
    campusDraft.buildings.push(entry);
    addCampusDraftLayer(L.polygon(points, {
      color: "#9ca3af",
      fillColor: "#c7ccd4",
      fillOpacity: 0.55,
      weight: 2
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

  if (type === "building") {
    saveCampusLine("building", name, activeBuildingDraft);
    activeBuildingDraft = [];
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
      L.marker(point).bindPopup(`${name}<br>${meta.label}<br>${point[0]}, ${point[1]}`)
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
      L.marker(point).bindPopup(`${name}<br>Pickup / drop-off<br>${point[0]}, ${point[1]}`)
    );
  }

  if (typeInput.value === "path") {
    activePathDraft.push(point);
    drawActiveShape("path", activePathDraft);
  }

  if (typeInput.value === "building") {
    activeBuildingDraft.push(point);
    drawActiveShape("building", activeBuildingDraft);
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
