import {
  getCampusMapData,
  saveCampusDataToFirestore,
  CAMPUS_CATEGORY_META,
  listenToCampusData
} from "./campus-data.js";

// Map editor state
let map = null;
let activeTab = "seed";
let satelliteLayer = null;
let baseTileLayer = null;
let isSatelliteMode = false;

// Geolocation tracking
let gpsWatchId = null;
let userLocationMarker = null;
let userLocationCircle = null;

// Seeder state
let activeSeedItem = null; // Currently selected unmapped location

// Measurement state
let isMeasureMode = false;
let measurePoints = [];
let measureMarkers = [];
let measureLine = null;

// Layers
let markersLayerGroup = null;
let stopsLayerGroup = null;
let roadsLayerGroup = null;
let buildingsLayerGroup = null;

// Draft and Undo/Redo stack
let mapDataDraft = null; // Deep copy of the working campus data
let undoStack = [];
let redoStack = [];

export function initAdminMapEditor(mapInstance) {
  map = mapInstance;
  
  // Clone current map data into draft
  const currentData = getCampusMapData();
  mapDataDraft = JSON.parse(JSON.stringify(currentData));

  // Initialize Layer Groups
  markersLayerGroup = L.layerGroup().addTo(map);
  stopsLayerGroup = L.layerGroup().addTo(map);
  roadsLayerGroup = L.layerGroup().addTo(map);
  buildingsLayerGroup = L.layerGroup().addTo(map);

  // Initialize Satellite Layer
  satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    maxZoom: 20
  });

  // Bind base tile layer (assuming it's the first layer added to map)
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer && layer !== satelliteLayer) {
      baseTileLayer = layer;
    }
  });

  // Load draft from localStorage if available
  const savedDraft = localStorage.getItem("me_map_draft");
  if (savedDraft) {
    try {
      mapDataDraft = JSON.parse(savedDraft);
      showStatus("Draft loaded from local auto-save.", "good");
    } catch (e) {
      console.warn("Could not load draft from auto-save:", e);
    }
  }

  // Set up event listeners
  setupBottomSheetDrag();
  setupTabSwitcher();
  setupSatelliteToggle();
  setupGpsTracking();
  setupSeeder();
  setupFormHandlers();
  setupGeneralControls();
  setupGeneralActions();

  // Render everything
  renderAllLayers();
  updateSeederList();

  // Watch for external cloud data updates
  listenToCampusData((freshData) => {
    // If we don't have local unsaved changes, sync with fresh cloud data
    if (!hasUnsavedChanges()) {
      mapDataDraft = JSON.parse(JSON.stringify(freshData));
      renderAllLayers();
      updateSeederList();
    }
  });

  // Handle map zoom changes to show accuracy guidance
  map.on("zoomend", updateZoomIndicator);
  updateZoomIndicator();
}

// ── State Management ─────────────────────────────────────
function hasUnsavedChanges() {
  const original = JSON.stringify(getCampusMapData());
  const working = JSON.stringify(mapDataDraft);
  return original !== working;
}

function pushToHistory() {
  undoStack.push(JSON.stringify(mapDataDraft));
  redoStack = []; // Clear redo stack on new action
  saveDraftToLocalStorage();
}

function saveDraftToLocalStorage() {
  localStorage.setItem("me_map_draft", JSON.stringify(mapDataDraft));
}

function showStatus(text, type = "") {
  const el = document.getElementById("meMapStatus");
  if (!el) return;
  el.innerText = text;
  el.className = "me-map-status";
  if (type) el.classList.add(type);
}

function updateZoomIndicator() {
  const zoom = map.getZoom();
  if (zoom < 18) {
    showStatus(`Zoom Level: ${zoom} (Zoom in to 18+ for accuracy)`, "warn");
  } else {
    showStatus(`Zoom Level: ${zoom} (High Accuracy Mode)`, "good");
  }
}

// ── Bottom Sheet Dragging ────────────────────────────────
function setupBottomSheetDrag() {
  const handleWrap = document.getElementById("meSheetHandle");
  const sheet = document.getElementById("meSheet");
  if (!handleWrap || !sheet) return;

  let startY = 0;
  let startHeight = 0;

  const onDragStart = (e) => {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startHeight = sheet.getBoundingClientRect().height;
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    sheet.style.transition = "none"; // Disable CSS animation while dragging
  };

  const onDragMove = (e) => {
    const currentY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaY = startY - currentY; // Upward drag is positive
    const newHeight = startHeight + deltaY;
    const vh = window.innerHeight;

    // Constrain height between 20% and 80% viewport height
    if (newHeight > vh * 0.2 && newHeight < vh * 0.8) {
      sheet.style.height = `${newHeight}px`;
    }
    e.preventDefault(); // Stop page scrolling
  };

  const onDragEnd = () => {
    document.removeEventListener("touchmove", onDragMove);
    document.removeEventListener("touchend", onDragEnd);
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    sheet.style.transition = "height 0.2s ease"; // Re-enable transition
  };

  handleWrap.addEventListener("touchstart", onDragStart, { passive: true });
  handleWrap.addEventListener("mousedown", onDragStart);
}

// ── Tab Bar Switcher ─────────────────────────────────────
function setupTabSwitcher() {
  const tabs = document.querySelectorAll(".me-tab");
  const panels = document.querySelectorAll(".me-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      activeTab = targetTab;

      tabs.forEach(t => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });

      panels.forEach(p => {
        p.classList.toggle("active", p.id === `me-panel-${targetTab}`);
      });

      // Clear seeder overlay if switching tabs
      cancelSeederMode();

      // Trigger map resize since visible container area shifts
      setTimeout(() => map.invalidateSize(), 50);
    });
  });
}

// ── Satellite Toggle ─────────────────────────────────────
function setupSatelliteToggle() {
  const btn = document.getElementById("meTileBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    isSatelliteMode = !isSatelliteMode;
    btn.classList.toggle("active", isSatelliteMode);
    
    if (isSatelliteMode) {
      if (baseTileLayer) map.removeLayer(baseTileLayer);
      satelliteLayer.addTo(map);
      btn.innerHTML = `<i class="fas fa-map"></i>`;
      btn.title = "Switch to Map View";
    } else {
      map.removeLayer(satelliteLayer);
      if (baseTileLayer) baseTileLayer.addTo(map);
      btn.innerHTML = `<i class="fas fa-satellite"></i>`;
      btn.title = "Switch to Satellite View";
    }
  });
}

// ── GPS Tracking & Live Locate ───────────────────────────
function setupGpsTracking() {
  const btn = document.getElementById("meLocateBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (gpsWatchId !== null) {
      // Toggle off
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
      btn.classList.remove("active");
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      if (userLocationCircle) map.removeLayer(userLocationCircle);
      userLocationMarker = null;
      userLocationCircle = null;
      showStatus("GPS location tracking disabled.");
      return;
    }

    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    btn.classList.add("active");
    showStatus("Starting GPS tracking...", "good");

    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const latlng = [latitude, longitude];

        // Update accuracy status pill
        if (accuracy > 15) {
          showStatus(`GPS Accuracy: ${Math.round(accuracy)}m (Poor accuracy. Move to open area)`, "warn");
        } else {
          showStatus(`GPS Accuracy: ${Math.round(accuracy)}m (Good accuracy)`, "good");
        }

        // Draw accuracy circle
        if (userLocationCircle) {
          userLocationCircle.setLatLng(latlng).setRadius(accuracy);
        } else {
          userLocationCircle = L.circle(latlng, {
            radius: accuracy,
            color: "#2563eb",
            fillColor: "#3b82f6",
            fillOpacity: 0.15,
            weight: 1
          }).addTo(map);
        }

        // Draw blue dot marker
        if (userLocationMarker) {
          userLocationMarker.setLatLng(latlng);
        } else {
          userLocationMarker = L.circleMarker(latlng, {
            radius: 8,
            color: "#ffffff",
            fillColor: "#2563eb",
            fillOpacity: 0.9,
            weight: 2
          }).addTo(map).bindPopup("You are here");
        }

        // Auto-center map on first position or high accuracy
        map.setView(latlng, Math.max(map.getZoom(), 18));
      },
      (err) => {
        console.error("GPS Error:", err);
        showStatus(`GPS Error: ${err.message}`, "warn");
        btn.classList.remove("active");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  });
}

// ── Smart Location Seeder ────────────────────────────────
function setupSeeder() {
  const overlay = document.getElementById("meSeederOverlay");
  const cancelBtn = document.getElementById("meSeederCancelBtn");
  const dropBtn = document.getElementById("meSeederDropBtn");
  const gpsBtn = document.getElementById("meSeederGpsBtn");
  const searchInput = document.getElementById("meSeedSearch");

  if (cancelBtn) cancelBtn.addEventListener("click", cancelSeederMode);
  
  if (dropBtn) {
    dropBtn.addEventListener("click", () => {
      if (!activeSeedItem) return;
      
      // Grab center of map crosshair coordinates
      const center = map.getCenter();
      saveSeededLocation(activeSeedItem, center.lat, center.lng);
    });
  }

  if (gpsBtn) {
    gpsBtn.addEventListener("click", () => {
      if (!activeSeedItem) return;

      if (!navigator.geolocation) {
        alert("GPS not available");
        return;
      }

      showStatus("Retrieving precise GPS...", "good");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          if (accuracy > 20) {
            if (!confirm(`GPS accuracy is low (${Math.round(accuracy)}m). Drop pin here anyway?`)) {
              return;
            }
          }
          saveSeededLocation(activeSeedItem, latitude, longitude);
        },
        (err) => {
          alert(`Could not get GPS coordinate: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      updateSeederList();
    });
  }
}

function updateSeederList() {
  const container = document.getElementById("meSeedList");
  const countEl = document.getElementById("meSeedCount");
  const totalEl = document.getElementById("meSeedTotal");
  if (!container) return;

  const searchQuery = document.getElementById("meSeedSearch")?.value.toLowerCase().trim() || "";
  const locations = mapDataDraft.locations || [];
  let mappedCount = 0;

  // Group locations into mapped and unmapped
  const unmapped = [];
  const mapped = [];

  locations.forEach(loc => {
    const isMapped = loc.lat !== null && loc.lng !== null;
    if (isMapped) {
      mappedCount++;
    }

    // Apply search filter if query exists
    if (searchQuery) {
      const matchName = loc.name.toLowerCase().includes(searchQuery);
      const categoryMeta = CAMPUS_CATEGORY_META[loc.category] || { label: "" };
      const matchCat = categoryMeta.label.toLowerCase().includes(searchQuery);
      if (!matchName && !matchCat) return; // Skip non-matching items
    }

    if (isMapped) {
      mapped.push(loc);
    } else {
      unmapped.push(loc);
    }
  });

  if (countEl) countEl.innerText = mappedCount;
  if (totalEl) totalEl.innerText = locations.length;

  container.innerHTML = "";

  // Render unmapped first
  unmapped.forEach(loc => {
    const item = createSeederItemHtml(loc, false);
    container.appendChild(item);
  });

  // Render mapped locations below
  mapped.forEach(loc => {
    const item = createSeederItemHtml(loc, true);
    container.appendChild(item);
  });

  if (locations.length === 0) {
    container.innerHTML = '<p class="me-panel__sub" style="text-align:center; padding: 20px;">No locations configured in campus-data.js</p>';
  }
}

function createSeederItemHtml(location, isMapped) {
  const item = document.createElement("div");
  item.className = `me-seed-item ${isMapped ? 'mapped' : ''}`;
  if (activeSeedItem && activeSeedItem.id === location.id) {
    item.classList.add("active-seed");
  }

  const categoryMeta = CAMPUS_CATEGORY_META[location.category] || { label: "Landmark", icon: "fa-map-pin", color: "#64748b" };

  item.innerHTML = `
    <div class="me-seed-status">
      <i class="fas ${isMapped ? 'fa-circle-check' : 'fa-triangle-exclamation'}" style="color: ${isMapped ? '#22c55e' : '#f59e0b'}"></i>
    </div>
    <div class="me-seed-info">
      <div class="me-seed-name">${location.name}</div>
      <div class="me-seed-meta">${isMapped ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : '⚠️ Missing Coordinates'}</div>
    </div>
    <div class="me-seed-category" style="border-left: 3px solid ${categoryMeta.color}">
      ${categoryMeta.label}
    </div>
  `;

  item.addEventListener("click", () => {
    startSeederMode(location);
  });

  return item;
}

function startSeederMode(location) {
  activeSeedItem = location;
  
  // Show seeder prompt card overlay
  const overlay = document.getElementById("meSeederOverlay");
  const nameEl = document.getElementById("meSeederName");
  if (overlay && nameEl) {
    nameEl.innerText = location.name;
    overlay.classList.remove("hidden");
  }

  // Update visual selection in list
  updateSeederList();

  // If the location has coordinates, pan map there
  if (location.lat !== null && location.lng !== null) {
    map.setView([location.lat, location.lng], 19);
  }
}

function cancelSeederMode() {
  activeSeedItem = null;
  const overlay = document.getElementById("meSeederOverlay");
  if (overlay) overlay.classList.add("hidden");
  updateSeederList();
}

function saveSeededLocation(location, lat, lng) {
  pushToHistory();

  // Find location in draft and save coords
  const index = mapDataDraft.locations.findIndex(l => l.id === location.id);
  if (index !== -1) {
    mapDataDraft.locations[index].lat = Number(lat.toFixed(6));
    mapDataDraft.locations[index].lng = Number(lng.toFixed(6));
  }

  showStatus(`Updated ${location.name} coordinates!`, "good");
  saveDraftToLocalStorage();
  renderAllLayers();
  cancelSeederMode();
}

// ── Form Option Populators ──────────────────────────────
function setupFormHandlers() {
  // Populate category options in Pin form
  const categorySelect = document.getElementById("mePinCategory");
  if (categorySelect) {
    categorySelect.innerHTML = Object.entries(CAMPUS_CATEGORY_META)
      .map(([key, val]) => `<option value="${key}">${val.label}</option>`)
      .join("");
  }

  // Update serves list in stop tab
  updateStopServesChecklist();
}

function updateStopServesChecklist() {
  const container = document.getElementById("meStopServesList");
  if (!container) return;

  const locations = mapDataDraft.locations || [];
  container.innerHTML = locations.map(loc => `
    <label>
      <input type="checkbox" name="meStopServes" value="${loc.id}">
      <span>${loc.name}</span>
    </label>
  `).join("");
}

// ── Placement & Draw Handlers (Pin, Stop, Road) ───────────
function setupGeneralControls() {
  const pinNameInput = document.getElementById("mePinName");
  const pinIdInput = document.getElementById("mePinId");
  const stopNameInput = document.getElementById("meStopName");

  // ── Live Validation Helpers
  const checkPinValidation = () => {
    const name = pinNameInput.value.trim();
    const id = pinIdInput.value.trim();
    if (!name) {
      showValidation("mePinValidation", "");
      return;
    }
    if (mapDataDraft.locations.some(loc => loc.id === id)) {
      showValidation("mePinValidation", `⚠️ ID "${id}" is already used by another marker.`);
      return;
    }
    if (mapDataDraft.locations.some(loc => loc.name.toLowerCase() === name.toLowerCase())) {
      showValidation("mePinValidation", `⚠️ A marker named "${name}" already exists.`, "ok");
      return;
    }
    showValidation("mePinValidation", "✓ ID is available", "ok");
  };

  const checkStopValidation = () => {
    const name = stopNameInput.value.trim();
    if (!name) {
      showValidation("meStopValidation", "");
      return;
    }
    const id = slugify(name);
    if (mapDataDraft.rideStops.some(stop => stop.id === id)) {
      showValidation("meStopValidation", `⚠️ A stop with ID "${id}" already exists.`);
      return;
    }
    showValidation("meStopValidation", "✓ Stop name is available", "ok");
  };

  // ── Auto Slug Generation & Live Duplicate checking
  if (pinNameInput && pinIdInput) {
    pinNameInput.addEventListener("input", () => {
      pinIdInput.value = slugify(pinNameInput.value);
      checkPinValidation();
    });
    pinIdInput.addEventListener("input", checkPinValidation);
  }

  if (stopNameInput) {
    stopNameInput.addEventListener("input", checkStopValidation);
  }

  // ── Placement tab "Place Pin"
  const placePinBtn = document.getElementById("mePlacePinBtn");
  if (placePinBtn) {
    placePinBtn.addEventListener("click", () => {
      const name = pinNameInput.value.trim();
      const category = document.getElementById("mePinCategory").value;
      const id = pinIdInput.value.trim() || slugify(name);
      
      let lat = parseFloat(document.getElementById("mePinLat").value);
      let lng = parseFloat(document.getElementById("mePinLng").value);

      // Fallback to crosshair center if coords empty
      if (isNaN(lat) || isNaN(lng)) {
        const center = map.getCenter();
        lat = center.lat;
        lng = center.lng;
      }

      if (!name) {
        showValidation("mePinValidation", "Please enter a location name.");
        return;
      }

      // Final double check for duplicate ID
      if (mapDataDraft.locations.some(loc => loc.id === id)) {
        showValidation("mePinValidation", `Error: ID "${id}" already exists.`);
        return;
      }

      // Check coordinates region safety boundaries (Veritas is around 9.28, 7.41)
      if (lat < 9.20 || lat > 9.35 || lng < 7.35 || lng > 7.48) {
        if (!confirm(`Warning: Coordinates (${lat.toFixed(6)}, ${lng.toFixed(6)}) seem to be outside the Veritas University region (expected near 9.28, 7.41). Place pin anyway?`)) {
          return;
        }
      }

      pushToHistory();
      mapDataDraft.locations.push({
        id,
        name,
        category,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6))
      });

      showValidation("mePinValidation", "Campus marker placed successfully!", "ok");
      saveDraftToLocalStorage();
      renderAllLayers();
      updateSeederList();
      updateStopServesChecklist();

      // Clear fields
      pinNameInput.value = "";
      pinIdInput.value = "";
      document.getElementById("mePinLat").value = "";
      document.getElementById("mePinLng").value = "";
    });
  }

  // ── Placement GPS fillers
  document.getElementById("mePinGpsBtn")?.addEventListener("click", () => {
    fillGpsCoords("mePinLat", "mePinLng", "mePinValidation");
  });
  document.getElementById("meStopGpsBtn")?.addEventListener("click", () => {
    fillGpsCoords("meStopLat", "meStopLng", "meStopValidation");
  });

  // ── Placement tab "Place Stop"
  const placeStopBtn = document.getElementById("mePlaceStopBtn");
  if (placeStopBtn) {
    placeStopBtn.addEventListener("click", () => {
      const name = stopNameInput.value.trim();
      let lat = parseFloat(document.getElementById("meStopLat").value);
      let lng = parseFloat(document.getElementById("meStopLng").value);

      // Checkbox selections for serves
      const checkedBoxes = document.querySelectorAll('input[name="meStopServes"]:checked');
      const serves = Array.from(checkedBoxes).map(cb => cb.value);

      // Fallback to crosshair center
      if (isNaN(lat) || isNaN(lng)) {
        const center = map.getCenter();
        lat = center.lat;
        lng = center.lng;
      }

      if (!name) {
        showValidation("meStopValidation", "Please enter a stop name.");
        return;
      }

      const id = slugify(name);
      if (mapDataDraft.rideStops.some(stop => stop.id === id)) {
        showValidation("meStopValidation", `Error: Stop "${name}" already exists.`);
        return;
      }

      // Check coordinates region safety boundaries
      if (lat < 9.20 || lat > 9.35 || lng < 7.35 || lng > 7.48) {
        if (!confirm(`Warning: Coordinates (${lat.toFixed(6)}, ${lng.toFixed(6)}) seem to be outside the Veritas University region (expected near 9.28, 7.41). Place stop anyway?`)) {
          return;
        }
      }

      pushToHistory();
      mapDataDraft.rideStops.push({
        id,
        name,
        type: "pickup_dropoff",
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        serves
      });

      showValidation("meStopValidation", "Ride stop placed successfully!", "ok");
      saveDraftToLocalStorage();
      renderAllLayers();

      // Clear fields
      stopNameInput.value = "";
      document.getElementById("meStopLat").value = "";
      document.getElementById("meStopLng").value = "";
      checkedBoxes.forEach(cb => cb.checked = false);
    });
  }

  // ── Road Drawing Logic
  let activeRoadPoints = [];
  let activeRoadLineLayer = null;

  const roadAddBtn = document.getElementById("meRoadAddBtn");
  const roadUndoBtn = document.getElementById("meRoadUndoBtn");
  const roadSaveBtn = document.getElementById("meRoadSaveBtn");
  const roadStatus = document.getElementById("meRoadStatus");

  if (roadAddBtn && roadStatus) {
    roadAddBtn.addEventListener("click", () => {
      const center = map.getCenter();
      const pt = [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))];
      
      activeRoadPoints.push(pt);
      
      // Update preview line — matches final road style so WYSIWYG while drawing
      if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
      activeRoadLineLayer = L.polyline(activeRoadPoints, {
        color: "#9ca3af",
        weight: 2,
        opacity: 0.72,
        lineCap: "round",
        lineJoin: "round",
        dashArray: "6, 4"   // dashed so it's clear it's still a draft
      }).addTo(map);

      roadStatus.innerText = `${activeRoadPoints.length} point(s) placed. Last: ${pt[0]}, ${pt[1]}`;
    });
  }

  if (roadUndoBtn && roadStatus) {
    roadUndoBtn.addEventListener("click", () => {
      if (activeRoadPoints.length === 0) return;
      activeRoadPoints.pop();

      if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
      if (activeRoadPoints.length > 0) {
        activeRoadLineLayer = L.polyline(activeRoadPoints, {
          color: "#9ca3af",
          weight: 2,
          opacity: 0.72,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "6, 4"
        }).addTo(map);
        roadStatus.innerText = `${activeRoadPoints.length} point(s) placed.`;
      } else {
        activeRoadLineLayer = null;
        roadStatus.innerText = "No points yet. Start walking and tap Add Point.";
      }
    });
  }

  if (roadSaveBtn && roadStatus) {
    roadSaveBtn.addEventListener("click", () => {
      const name = document.getElementById("meRoadName").value.trim();
      
      if (activeRoadPoints.length < 2) {
        alert("Road needs at least 2 points.");
        return;
      }
      if (!name) {
        alert("Please enter a road name.");
        return;
      }

      pushToHistory();

      const roadId = slugify(name) + "_" + Date.now().toString().slice(-4);
      mapDataDraft.paths.push({
        id: roadId,
        name: name,
        points: activeRoadPoints
      });

      // Clear active draw
      if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
      activeRoadLineLayer = null;
      activeRoadPoints = [];
      document.getElementById("meRoadName").value = "";
      roadStatus.innerText = "Road saved successfully!";

      saveDraftToLocalStorage();
      renderAllLayers();
    });
  }
}

function fillGpsCoords(latId, lngId, validationId) {
  if (!navigator.geolocation) {
    showValidation(validationId, "GPS not supported.");
    return;
  }
  showValidation(validationId, "Fetching GPS...", "ok");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById(latId).value = pos.coords.latitude.toFixed(6);
      document.getElementById(lngId).value = pos.coords.longitude.toFixed(6);
      showValidation(validationId, `GPS locked! (${Math.round(pos.coords.accuracy)}m)`, "ok");
    },
    (err) => {
      showValidation(validationId, `GPS lock failed: ${err.message}`);
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

function showValidation(id, msg, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = msg;
  el.className = "me-validation-msg";
  if (type === "ok") el.classList.add("ok");
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unnamed";
}

// ── Layer Visibility Toggle ──────────────────────────────
const layersBtn = document.getElementById("meLayerToggleBtn");
const layersContainer = document.getElementById("meLayers");
if (layersBtn && layersContainer) {
  layersBtn.addEventListener("click", () => {
    layersContainer.classList.toggle("hidden");
  });
}

// Bind layer checkboxes
document.getElementById("meLayerLocations")?.addEventListener("change", (e) => {
  if (e.target.checked) markersLayerGroup.addTo(map);
  else map.removeLayer(markersLayerGroup);
});
document.getElementById("meLayerStops")?.addEventListener("change", (e) => {
  if (e.target.checked) stopsLayerGroup.addTo(map);
  else map.removeLayer(stopsLayerGroup);
});
document.getElementById("meLayerRoads")?.addEventListener("change", (e) => {
  if (e.target.checked) roadsLayerGroup.addTo(map);
  else map.removeLayer(roadsLayerGroup);
});
document.getElementById("meLayerBuildings")?.addEventListener("change", (e) => {
  if (e.target.checked) buildingsLayerGroup.addTo(map);
  else map.removeLayer(buildingsLayerGroup);
});

// ── Rendering map elements ───────────────────────────────
function createDivIcon(category) {
  const meta = CAMPUS_CATEGORY_META[category] || { label: "Landmark", icon: "fa-map-pin", color: "#64748b" };
  return L.divIcon({
    html: `
      <div class="campus-marker" style="--marker-color: ${meta.color}">
        <i class="fas ${meta.icon}"></i>
      </div>
    `,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28]
  });
}

function renderAllLayers() {
  if (!map) return;

  // Clear existing renders
  markersLayerGroup.clearLayers();
  stopsLayerGroup.clearLayers();
  roadsLayerGroup.clearLayers();
  buildingsLayerGroup.clearLayers();

  // Render Locations / Markers
  const locations = mapDataDraft.locations || [];
  locations.forEach(loc => {
    if (loc.lat === null || loc.lng === null) return;
    
    const popupHtml = `
      <div class="campus-popup">
        <strong>${loc.name}</strong><br>
        <span>Category: ${loc.category}</span><br>
        <span style="font-size:10px; color:#64748b">${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}</span><br>
        <button type="button" class="btn" style="margin-top:8px; padding:3px 8px; font-size:11px" id="edit-loc-${loc.id}">Edit Pin</button>
      </div>
    `;

    const marker = L.marker([loc.lat, loc.lng], {
      icon: createDivIcon(loc.category)
    }).addTo(markersLayerGroup).bindPopup(popupHtml);

    marker.on("popupopen", () => {
      document.getElementById(`edit-loc-${loc.id}`)?.addEventListener("click", () => {
        startSeederMode(loc);
        marker.closePopup();
      });
    });
  });

  // Render Ride Stops
  const stops = mapDataDraft.rideStops || [];
  stops.forEach(stop => {
    if (stop.lat === null || stop.lng === null) return;

    const popupHtml = `
      <div class="campus-popup">
        <strong>${stop.name} (Stop)</strong><br>
        <span>Serves: ${(stop.serves || []).join(", ") || 'None'}</span><br>
        <span style="font-size:10px; color:#64748b">${stop.lat.toFixed(6)}, ${stop.lng.toFixed(6)}</span><br>
        <button type="button" class="btn btn-danger" style="margin-top:8px; padding:3px 8px; font-size:11px" id="del-stop-${stop.id}">Delete Stop</button>
      </div>
    `;

    const marker = L.marker([stop.lat, stop.lng], {
      icon: createDivIcon("pickup")
    }).addTo(stopsLayerGroup).bindPopup(popupHtml);

    marker.on("popupopen", () => {
      document.getElementById(`del-stop-${stop.id}`)?.addEventListener("click", () => {
        if (confirm(`Delete stop: ${stop.name}?`)) {
          pushToHistory();
          mapDataDraft.rideStops = mapDataDraft.rideStops.filter(s => s.id !== stop.id);
          saveDraftToLocalStorage();
          renderAllLayers();
        }
      });
    });
  });

  // Render Road / Paths
  const paths = mapDataDraft.paths || [];
  paths.forEach(path => {
    if (!Array.isArray(path.points) || path.points.length < 2) return;

    // Support nested standard road coordinate lists
    const latlngs = path.points.map(pt => {
      if (Array.isArray(pt)) return [pt[0], pt[1]];
      return [pt.lat, pt.lng];
    });

    const polyline = L.polyline(latlngs, {
      color: "#9ca3af",
      weight: 2,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(roadsLayerGroup).bindPopup(`
      <div class="campus-popup">
        <strong>Road: ${path.name}</strong><br>
        <button type="button" class="btn btn-danger" style="margin-top:8px; padding:3px 8px; font-size:11px" id="del-road-${path.id}">Delete Road</button>
      </div>
    `);

    polyline.on("popupopen", () => {
      document.getElementById(`del-road-${path.id}`)?.addEventListener("click", () => {
        if (confirm(`Delete road network segment: ${path.name}?`)) {
          pushToHistory();
          mapDataDraft.paths = mapDataDraft.paths.filter(p => p.id !== path.id);
          saveDraftToLocalStorage();
          renderAllLayers();
        }
      });
    });
  });

  // Render Buildings
  const buildings = mapDataDraft.buildings || [];
  buildings.forEach(b => {
    if (!Array.isArray(b.points) || b.points.length < 3) return;

    const latlngs = b.points.map(pt => {
      if (Array.isArray(pt)) return [pt[0], pt[1]];
      return [pt.lat, pt.lng];
    });

    L.polygon(latlngs, {
      color: "#6b7280",
      fillColor: "#9ca3af",
      fillOpacity: 0.25,
      weight: 1.5
    }).addTo(buildingsLayerGroup).bindPopup(`Building: ${b.name}`);
  });

  // Keep advanced JSON text area updated
  const jsonArea = document.getElementById("meJsonEditor");
  if (jsonArea) jsonArea.value = JSON.stringify(mapDataDraft, null, 2);

  const campusDataEditor = document.getElementById("campusDataEditor");
  if (campusDataEditor) {
    campusDataEditor.value = JSON.stringify(mapDataDraft, null, 2);
    campusDataEditor.dispatchEvent(new Event("input"));
  }

  // Update local diagnostic details
  updateGraphStatusDetails();
}

function updateGraphStatusDetails() {
  const el = document.getElementById("meGraphStatus");
  if (!el) return;

  const locs = mapDataDraft.locations || [];
  const stops = mapDataDraft.rideStops || [];
  const roads = mapDataDraft.paths || [];

  const unmapped = locs.filter(l => l.lat === null || l.lng === null).length;

  el.className = "me-graph-status";
  if (unmapped > 0) {
    el.classList.add("warning");
    el.innerText = `Work pending: ${unmapped} location(s) require coordinate seeding.`;
  } else {
    el.classList.add("good");
    el.innerText = `Seeding Complete! All ${locs.length} locations mapped. Total: ${stops.length} ride stops, ${roads.length} road segments.`;
  }
}

// ── Global Tools (Undo, Save, Reload, Export) ────────────
function setupGeneralActions() {
  // Undo button in topbar
  document.getElementById("meUndoBtn")?.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    
    // Save current to redo stack
    redoStack.push(JSON.stringify(mapDataDraft));
    
    // Pop from undo stack
    const prev = undoStack.pop();
    mapDataDraft = JSON.parse(prev);
    
    saveDraftToLocalStorage();
    renderAllLayers();
    updateSeederList();
    updateStopServesChecklist();
    showStatus("Undid last map edit.", "good");
  });

  // Redo button in topbar
  document.getElementById("meRedoBtn")?.addEventListener("click", () => {
    if (redoStack.length === 0) return;

    // Save current to undo stack
    undoStack.push(JSON.stringify(mapDataDraft));

    // Pop from redo stack
    const next = redoStack.pop();
    mapDataDraft = JSON.parse(next);

    saveDraftToLocalStorage();
    renderAllLayers();
    updateSeederList();
    updateStopServesChecklist();
    showStatus("Redid map edit.", "good");
  });

  // Save to Cloud in topbar
  const saveCloudBtn = document.getElementById("meSaveBtn");
  if (saveCloudBtn) {
    saveCloudBtn.addEventListener("click", async () => {
      saveCloudBtn.disabled = true;
      saveCloudBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
      showStatus("Saving map data to Cloud database...", "good");

      try {
        await saveCampusDataToFirestore(mapDataDraft);
        showStatus("Campus Map Data successfully synced to cloud!", "good");
        alert("Campus map data successfully written to cloud!");
      } catch (err) {
        console.error("Cloud write failed:", err);
        showStatus(`Cloud write failed: ${err.message}`, "warn");
        alert(`Failed to save to cloud: ${err.message}`);
      } finally {
        saveCloudBtn.disabled = false;
        saveCloudBtn.innerHTML = `<i class="fas fa-cloud-arrow-up"></i>`;
      }
    });
  }

  // Export JSON
  document.getElementById("meExportBtn")?.addEventListener("click", () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mapDataDraft, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `campus-map-data-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Reload cloud
  document.getElementById("meReloadBtn")?.addEventListener("click", async () => {
    if (confirm("Discard all unsaved edits and reload fresh map data from cloud?")) {
      localStorage.removeItem("me_map_draft");
      undoStack = [];
      redoStack = [];
      
      const btn = document.getElementById("meReloadBtn");
      btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading`;
      
      try {
        const freshData = getCampusMapData();
        mapDataDraft = JSON.parse(JSON.stringify(freshData));
        renderAllLayers();
        updateSeederList();
        updateStopServesChecklist();
        showStatus("Map successfully reloaded from cloud.", "good");
      } catch (e) {
        alert("Reload failed.");
      } finally {
        btn.innerHTML = `<i class="fas fa-rotate"></i> <span>Reload Cloud</span>`;
      }
    }
  });

  // Clear Draft
  document.getElementById("meClearDraftBtn")?.addEventListener("click", () => {
    if (confirm("Reset current draft? This deletes local localStorage cache.")) {
      localStorage.removeItem("me_map_draft");
      undoStack = [];
      redoStack = [];
      const current = getCampusMapData();
      mapDataDraft = JSON.parse(JSON.stringify(current));
      renderAllLayers();
      updateSeederList();
      updateStopServesChecklist();
      showStatus("Draft reset.");
    }
  });

  // ── Advanced JSON tab panel actions
  document.getElementById("meJsonFormatBtn")?.addEventListener("click", () => {
    const jsonArea = document.getElementById("meJsonEditor");
    if (!jsonArea) return;
    try {
      jsonArea.value = JSON.stringify(JSON.parse(jsonArea.value), null, 2);
    } catch (e) {
      alert("Invalid JSON: " + e.message);
    }
  });

  document.getElementById("meJsonSaveBtn")?.addEventListener("click", async () => {
    const jsonArea = document.getElementById("meJsonEditor");
    if (!jsonArea) return;
    try {
      const parsed = JSON.parse(jsonArea.value);
      pushToHistory();
      mapDataDraft = parsed;
      saveDraftToLocalStorage();
      renderAllLayers();
      updateSeederList();
      updateStopServesChecklist();
      alert("JSON updated successfully.");
    } catch (e) {
      alert("Invalid JSON format: " + e.message);
    }
  });

  // Initialize Measurement Tool
  setupMeasurementTool();
}

// ── Measurement Tool Logic ──────────────────────────────
function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function setupMeasurementTool() {
  const btn = document.getElementById("meMeasureBtn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    isMeasureMode = !isMeasureMode;
    btn.classList.toggle("active", isMeasureMode);
    
    if (isMeasureMode) {
      showStatus("Measure mode active: Tap 2 points on map to find distance.", "good");
      clearMeasure();
    } else {
      showStatus("Measure mode disabled.");
      clearMeasure();
    }
  });

  // Tap listener on map for measurement
  map.on("click", (e) => {
    if (!isMeasureMode) return;

    const latlng = e.latlng;
    measurePoints.push(latlng);

    // Place marker
    const marker = L.circleMarker(latlng, {
      radius: 6,
      color: "#f59e0b",
      fillColor: "#fbbf24",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(map);
    
    measureMarkers.push(marker);

    if (measurePoints.length === 1) {
      showStatus("Point A set. Tap second point.", "good");
    } else if (measurePoints.length === 2) {
      const distance = calculateDistanceMeters(
        measurePoints[0].lat, measurePoints[0].lng,
        measurePoints[1].lat, measurePoints[1].lng
      );
      
      // Draw line
      measureLine = L.polyline(measurePoints, {
        color: "#f59e0b",
        weight: 3,
        dashArray: "5, 5"
      }).addTo(map);

      showStatus(`Distance: ${Math.round(distance)} meters (Measure Mode)`, "good");
      alert(`Distance between points: ${Math.round(distance)} meters.`);
      
      // Reset after calculations so user can start a new measurement
      measurePoints = [];
    } else {
      // Clear previous markers
      clearMeasure();
      measurePoints.push(latlng);
      const newMarker = L.circleMarker(latlng, {
        radius: 6,
        color: "#f59e0b",
        fillColor: "#fbbf24",
        fillOpacity: 0.9,
        weight: 2
      }).addTo(map);
      measureMarkers.push(newMarker);
      showStatus("Point A set. Tap second point.", "good");
    }
  });
}

function clearMeasure() {
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = [];
  if (measureLine) map.removeLayer(measureLine);
  measureLine = null;
  measurePoints = [];
}

// Stop tracking geolocation when navigating away
export function stopAdminMapEditor() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  isMeasureMode = false;
  clearMeasure();
}
