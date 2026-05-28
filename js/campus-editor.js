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
let currentLocationLayer = null;
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
    saveShapeBtn: document.getElementById("saveCampusShapeBtn"),
    clearBtn: document.getElementById("clearCampusDraftBtn"),
    locateBtn: document.getElementById("locateCampusEditorBtn"),
    minimizeBtn: document.getElementById("minimizeCampusEditorBtn"),
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
      radius: 4,
      color: "#9ca3af"
    }).addTo(map);
    return;
  }

  activeShapeLayer = type === "path"
    ? L.polyline(points, { color: "#9ca3af", weight: 2, opacity: 0.72, dashArray: "5 6" }).addTo(map)
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
    addCampusDraftLayer(L.polyline(points, {
      color: "#9ca3af",
      weight: 2,
      opacity: 0.72,
      lineCap: "round"
    }));
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

function showCurrentLocation() {
  const elements = getCampusEditorElements();
  if (!navigator.geolocation) {
    if (elements.hint) elements.hint.innerText = "Location is not available on this device.";
    return;
  }

  if (elements.hint) elements.hint.innerText = "Getting your location...";
  navigator.geolocation.getCurrentPosition((pos) => {
    const point = [
      roundCoord(pos.coords.latitude),
      roundCoord(pos.coords.longitude)
    ];

    if (currentLocationLayer) {
      currentLocationLayer.setLatLng(point);
    } else {
      currentLocationLayer = L.circleMarker(point, {
        radius: 8,
        color: "#2563eb",
        fillColor: "#2563eb",
        fillOpacity: 0.85,
        weight: 3
      }).addTo(map).bindPopup("Your current location");
    }

    map.setView(point, Math.max(map.getZoom(), 18));
    currentLocationLayer.openPopup();
    if (elements.hint) {
      elements.hint.innerText = `Current location: ${point[0]}, ${point[1]}`;
    }
  }, (err) => {
    if (elements.hint) elements.hint.innerText = `Location unavailable: ${err.message}`;
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 15000
  });
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

  if (elements.clearBtn) elements.clearBtn.onclick = clearCampusDraft;
  if (elements.saveShapeBtn) elements.saveShapeBtn.onclick = saveActiveCampusShape;
  if (elements.locateBtn) elements.locateBtn.onclick = showCurrentLocation;
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
