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

// Building editor state
let activeBuildingPoints = [];
let activeBuildingPreviewLayer = null; // polygon/polyline preview while drawing

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
  setupBuildingEditor();
  setupGeneralControls();
  setupGeneralActions();
  setupRouteTab();
  setupSnapIndicator();
  setupMerge();

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

      // Track road drawing mode for snap indicator
      isRoadDrawingActive = (targetTab === "road");
      if (!isRoadDrawingActive) clearSnapIndicator();

      // Refresh route selectors when entering route tab
      if (targetTab === "route") populateRouteSelectors();

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
  const roadWeightSlider = document.getElementById("meRoadWeight");
  const roadWeightValue  = document.getElementById("meRoadWeightValue");

  function getRoadWeight() {
    return parseFloat(roadWeightSlider?.value ?? 3.5);
  }

  // Update the numeric label and live-redraw preview whenever slider moves
  roadWeightSlider?.addEventListener("input", () => {
    if (roadWeightValue) roadWeightValue.innerText = getRoadWeight();
    refreshRoadPreview();
  });

  /** Redraws the in-progress road preview. */
  function refreshRoadPreview() {
    if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
    activeRoadLineLayer = null;
    if (activeRoadPoints.length >= 2) {
      activeRoadLineLayer = L.polyline(activeRoadPoints, {
        color: "#f97316",
        weight: getRoadWeight(),
        opacity: 0.7,
        lineCap: "round",
        lineJoin: "round",
        dashArray: "8, 5"   // dashed = still a draft
      }).addTo(map);
    }
    if (roadStatus) {
      roadStatus.innerText = activeRoadPoints.length > 0
        ? `${activeRoadPoints.length} point(s) placed. Last: ${activeRoadPoints.at(-1).join(", ")}`
        : "No points yet. Start walking and tap Add Point.";
    }
  }

  // Listen for the extend-road event dispatched by startRoadExtension()
  document.addEventListener("me:extendRoad", (e) => {
    activeRoadPoints = e.detail.points.slice();
    if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
    activeRoadLineLayer = null;
    refreshRoadPreview();
    // Pan map to the last point of the road so admin can continue from there
    const last = activeRoadPoints.at(-1);
    if (last) map.setView(last, Math.max(map.getZoom(), 18));
  });

  if (roadAddBtn && roadStatus) {
    roadAddBtn.addEventListener("click", () => {
      const center = map.getCenter();
      const pt = [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))];
      activeRoadPoints.push(pt);
      refreshRoadPreview();
      // Trigger snap check immediately after adding
      updateSnapIndicator();
    });
  }

  if (roadUndoBtn && roadStatus) {
    roadUndoBtn.addEventListener("click", () => {
      if (activeRoadPoints.length === 0) return;
      activeRoadPoints.pop();
      refreshRoadPreview();
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

      if (extendingRoadId) {
        // Replace the existing road with the extended version
        const idx = mapDataDraft.paths.findIndex(p => p.id === extendingRoadId);
        if (idx !== -1) {
          mapDataDraft.paths[idx] = { ...mapDataDraft.paths[idx], name, points: activeRoadPoints };
          roadStatus.innerText = `Road "${name}" extended and saved!`;
        }
        extendingRoadId = null;
      } else {
        const roadId = slugify(name) + "_" + Date.now().toString().slice(-4);
        mapDataDraft.paths.push({ id: roadId, name, points: activeRoadPoints });
        roadStatus.innerText = "Road saved successfully!";
      }

      // Clear active draw
      if (activeRoadLineLayer) map.removeLayer(activeRoadLineLayer);
      activeRoadLineLayer = null;
      activeRoadPoints = [];
      document.getElementById("meRoadName").value = "";
      clearSnapIndicator();

      saveDraftToLocalStorage();
      renderAllLayers();
    });
  }
}

// ── Building Drawing Logic ───────────────────────────────
function setupBuildingEditor() {
  const addBtn    = document.getElementById("meBuildingAddBtn");
  const undoBtn   = document.getElementById("meBuildingUndoBtn");
  const saveBtn   = document.getElementById("meBuildingSaveBtn");
  const statusEl  = document.getElementById("meBuildingStatus");
  const nameInput = document.getElementById("meBuildingName");

  if (!addBtn || !undoBtn || !saveBtn || !statusEl || !nameInput) return;

  /** Redraws the in-progress polygon preview on the map. */
  function refreshPreview() {
    if (activeBuildingPreviewLayer) map.removeLayer(activeBuildingPreviewLayer);
    activeBuildingPreviewLayer = null;

    if (activeBuildingPoints.length === 0) {
      statusEl.innerText = "No points yet. Pan to a corner and tap Add Point.";
      return;
    }

    if (activeBuildingPoints.length === 1) {
      // Just a single dot — draw a small circle so the user can see it
      activeBuildingPreviewLayer = L.circleMarker(activeBuildingPoints[0], {
        radius: 5,
        color: "#6b7280",
        fillColor: "#9ca3af",
        fillOpacity: 0.7,
        weight: 2
      }).addTo(map);
    } else if (activeBuildingPoints.length === 2) {
      // Two points — just a line
      activeBuildingPreviewLayer = L.polyline(activeBuildingPoints, {
        color: "#6b7280",
        weight: 2,
        dashArray: "6, 4"
      }).addTo(map);
    } else {
      // 3+ points — draw as a dashed polygon so it's clear it's a draft
      activeBuildingPreviewLayer = L.polygon(activeBuildingPoints, {
        color: "#6b7280",
        fillColor: "#9ca3af",
        fillOpacity: 0.25,
        weight: 2,
        dashArray: "6, 4"
      }).addTo(map);
    }

    const last = activeBuildingPoints[activeBuildingPoints.length - 1];
    statusEl.innerText = `${activeBuildingPoints.length} point(s). Last: ${last[0]}, ${last[1]}`;
  }

  // Add Point — capture current map centre
  addBtn.addEventListener("click", () => {
    const center = map.getCenter();
    const pt = [Number(center.lat.toFixed(6)), Number(center.lng.toFixed(6))];
    activeBuildingPoints.push(pt);
    refreshPreview();
  });

  // Undo last point
  undoBtn.addEventListener("click", () => {
    if (activeBuildingPoints.length === 0) return;
    activeBuildingPoints.pop();
    refreshPreview();
  });

  // Save Building
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();

    if (activeBuildingPoints.length < 3) {
      alert("A building footprint needs at least 3 points.");
      return;
    }
    if (!name) {
      alert("Please enter a building name.");
      return;
    }

    pushToHistory();

    const buildingId = slugify(name) + "_" + Date.now().toString().slice(-4);
    if (!mapDataDraft.buildings) mapDataDraft.buildings = [];
    mapDataDraft.buildings.push({
      id: buildingId,
      name: name,
      points: activeBuildingPoints.slice() // snapshot
    });

    // Clear active draw
    if (activeBuildingPreviewLayer) map.removeLayer(activeBuildingPreviewLayer);
    activeBuildingPreviewLayer = null;
    activeBuildingPoints = [];
    nameInput.value = "";
    statusEl.innerText = "Building saved! Pan to the next one.";

    saveDraftToLocalStorage();
    renderAllLayers();
  });

  // Clear preview when switching away from building tab
  const tabs = document.querySelectorAll(".me-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab !== "building" && activeBuildingPreviewLayer) {
        map.removeLayer(activeBuildingPreviewLayer);
        activeBuildingPreviewLayer = null;
        activeBuildingPoints = [];
        statusEl.innerText = "No points yet. Pan to a corner and tap Add Point.";
        nameInput.value = "";
      }
    });
  });
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
        <div class="me-rename-row" id="rename-row-loc-${loc.id}" style="display:none; margin-top:6px;">
          <input type="text" class="me-rename-input" id="rename-input-loc-${loc.id}" value="${loc.name}" placeholder="New name">
          <button type="button" class="me-rename-save" id="rename-save-loc-${loc.id}">✓</button>
          <button type="button" class="me-rename-cancel" id="rename-cancel-loc-${loc.id}">✕</button>
        </div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px;" id="rename-btn-loc-${loc.id}">
            <i class="fas fa-pencil"></i> Rename
          </button>
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px; background:#3b82f6; color:#fff;" id="edit-loc-${loc.id}">
            <i class="fas fa-crosshairs"></i> Move
          </button>
        </div>
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
      setupRenameHandlers(`loc-${loc.id}`, (newName) => {
        const idx = mapDataDraft.locations.findIndex(l => l.id === loc.id);
        if (idx !== -1) { pushToHistory(); mapDataDraft.locations[idx].name = newName; saveDraftToLocalStorage(); renderAllLayers(); updateSeederList(); }
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
        <div class="me-rename-row" id="rename-row-stop-${stop.id}" style="display:none; margin-top:6px;">
          <input type="text" class="me-rename-input" id="rename-input-stop-${stop.id}" value="${stop.name}" placeholder="New name">
          <button type="button" class="me-rename-save" id="rename-save-stop-${stop.id}">✓</button>
          <button type="button" class="me-rename-cancel" id="rename-cancel-stop-${stop.id}">✕</button>
        </div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px;" id="rename-btn-stop-${stop.id}">
            <i class="fas fa-pencil"></i> Rename
          </button>
          <button type="button" class="btn btn-danger" style="padding:3px 8px; font-size:11px;" id="del-stop-${stop.id}">Delete</button>
        </div>
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
      setupRenameHandlers(`stop-${stop.id}`, (newName) => {
        const idx = mapDataDraft.rideStops.findIndex(s => s.id === stop.id);
        if (idx !== -1) { pushToHistory(); mapDataDraft.rideStops[idx].name = newName; saveDraftToLocalStorage(); renderAllLayers(); }
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
      color: "#f97316",
      weight: 3.5,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(roadsLayerGroup).bindPopup(`
      <div class="campus-popup">
        <strong>Road: ${path.name}</strong><br>
        <span style="font-size:10px; color:#64748b">${path.points.length} point(s)</span><br>
        <div class="me-rename-row" id="rename-row-road-${path.id}" style="display:none; margin-top:6px;">
          <input type="text" class="me-rename-input" id="rename-input-road-${path.id}" value="${path.name}" placeholder="New name">
          <button type="button" class="me-rename-save" id="rename-save-road-${path.id}">✓</button>
          <button type="button" class="me-rename-cancel" id="rename-cancel-road-${path.id}">✕</button>
        </div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px;" id="rename-btn-road-${path.id}">
            <i class="fas fa-pencil"></i> Rename
          </button>
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px; background:#3b82f6; color:#fff;" id="ext-road-${path.id}">
            <i class="fas fa-arrow-right-to-bracket"></i> Extend
          </button>
          <button type="button" class="btn btn-danger" style="padding:3px 8px; font-size:11px;" id="del-road-${path.id}">Delete</button>
        </div>
      </div>
    `);

    polyline.on("popupopen", () => {
      document.getElementById(`ext-road-${path.id}`)?.addEventListener("click", () => {
        polyline.closePopup();
        window.meStartRoadExtension(path.id);
      });
      document.getElementById(`del-road-${path.id}`)?.addEventListener("click", () => {
        if (confirm(`Delete road network segment: ${path.name}?`)) {
          pushToHistory();
          mapDataDraft.paths = mapDataDraft.paths.filter(p => p.id !== path.id);
          saveDraftToLocalStorage();
          renderAllLayers();
        }
      });
      setupRenameHandlers(`road-${path.id}`, (newName) => {
        const idx = mapDataDraft.paths.findIndex(p => p.id === path.id);
        if (idx !== -1) { pushToHistory(); mapDataDraft.paths[idx].name = newName; saveDraftToLocalStorage(); renderAllLayers(); updateMergeSelectors(); }
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

    const poly = L.polygon(latlngs, {
      color: "#6b7280",
      fillColor: "#9ca3af",
      fillOpacity: 0.25,
      weight: 1.5
    }).addTo(buildingsLayerGroup).bindPopup(`
      <div class="campus-popup">
        <strong>Building: ${b.name}</strong><br>
        <span style="font-size:10px; color:#64748b">${b.points.length} vertices</span><br>
        <div class="me-rename-row" id="rename-row-bld-${b.id}" style="display:none; margin-top:6px;">
          <input type="text" class="me-rename-input" id="rename-input-bld-${b.id}" value="${b.name}" placeholder="New name">
          <button type="button" class="me-rename-save" id="rename-save-bld-${b.id}">✓</button>
          <button type="button" class="me-rename-cancel" id="rename-cancel-bld-${b.id}">✕</button>
        </div>
        <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
          <button type="button" class="btn" style="padding:3px 8px; font-size:11px;" id="rename-btn-bld-${b.id}">
            <i class="fas fa-pencil"></i> Rename
          </button>
          <button type="button" class="btn btn-danger" style="padding:3px 8px; font-size:11px;" id="del-building-${b.id}">Delete</button>
        </div>
      </div>
    `);

    poly.on("popupopen", () => {
      document.getElementById(`del-building-${b.id}`)?.addEventListener("click", () => {
        if (confirm(`Delete building: ${b.name}?`)) {
          pushToHistory();
          mapDataDraft.buildings = mapDataDraft.buildings.filter(x => x.id !== b.id);
          saveDraftToLocalStorage();
          renderAllLayers();
        }
      });
      setupRenameHandlers(`bld-${b.id}`, (newName) => {
        const idx = mapDataDraft.buildings.findIndex(x => x.id === b.id);
        if (idx !== -1) { pushToHistory(); mapDataDraft.buildings[idx].name = newName; saveDraftToLocalStorage(); renderAllLayers(); }
      });
    });
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

  // Refresh route tab selectors if available (new locations/stops may have been added)
  if (activeTab === "route") populateRouteSelectors();
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

// ── Rename helpers ───────────────────────────────────────────────────────────

/**
 * Wires up the Rename button + inline input for any popup.
 * key   — unique suffix matching the id attributes (e.g. "road-abc123")
 * onSave(newName) — called with the trimmed new name on confirm
 */
function setupRenameHandlers(key, onSave) {
  const renameBtn   = document.getElementById(`rename-btn-${key}`);
  const renameRow   = document.getElementById(`rename-row-${key}`);
  const renameInput = document.getElementById(`rename-input-${key}`);
  const saveBtn     = document.getElementById(`rename-save-${key}`);
  const cancelBtn   = document.getElementById(`rename-cancel-${key}`);

  if (!renameBtn || !renameRow || !renameInput || !saveBtn || !cancelBtn) return;

  renameBtn.addEventListener("click", () => {
    renameRow.style.display = "flex";
    renameBtn.style.display = "none";
    renameInput.focus();
    renameInput.select();
  });

  cancelBtn.addEventListener("click", () => {
    renameRow.style.display = "none";
    renameBtn.style.display = "";
  });

  const doSave = () => {
    const newName = renameInput.value.trim();
    if (!newName) { renameInput.focus(); return; }
    onSave(newName);
    // renderAllLayers closes/reopens the popup so no need to hide manually
  };

  saveBtn.addEventListener("click", doSave);
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    if (e.key === "Escape") cancelBtn.click();
  });
}

// ── Road merge ───────────────────────────────────────────────────────────────

function updateMergeSelectors() {
  const aEl = document.getElementById("meMergeRoadA");
  const bEl = document.getElementById("meMergeRoadB");
  if (!aEl || !bEl) return;

  const opts = (mapDataDraft.paths || [])
    .map(p => `<option value="${p.id}">${p.name} (${p.points.length} pts)</option>`)
    .join("");
  const placeholder = `<option value="">— select road —</option>`;
  aEl.innerHTML = placeholder + opts;
  bEl.innerHTML = placeholder + opts;
}

function setupMerge() {
  updateMergeSelectors();

  document.getElementById("meMergeBtn")?.addEventListener("click", () => {
    const aId  = document.getElementById("meMergeRoadA").value;
    const bId  = document.getElementById("meMergeRoadB").value;
    const name = document.getElementById("meMergeName").value.trim();
    const valEl = document.getElementById("meMergeValidation");

    const showErr = (msg) => { if (valEl) { valEl.innerText = msg; valEl.className = "me-validation-msg"; } };
    const showOk  = (msg) => { if (valEl) { valEl.innerText = msg; valEl.className = "me-validation-msg ok"; } };

    if (!aId || !bId)  return showErr("Select both roads.");
    if (aId === bId)   return showErr("Select two different roads.");
    if (!name)         return showErr("Enter a name for the merged road.");

    const roadA = mapDataDraft.paths.find(p => p.id === aId);
    const roadB = mapDataDraft.paths.find(p => p.id === bId);
    if (!roadA || !roadB) return showErr("Road not found.");

    // Normalise points to [lat, lng] arrays
    const normPts = (pts) => pts.map(pt =>
      Array.isArray(pt) ? [Number(pt[0]), Number(pt[1])] : [Number(pt.lat), Number(pt.lng)]
    );

    const ptsA = normPts(roadA.points);
    const ptsB = normPts(roadB.points);

    // Figure out the best join: end of A → start/end of B
    // We check all four combinations and pick the one with the shortest gap
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const endA   = ptsA.at(-1);
    const startA = ptsA[0];
    const endB   = ptsB.at(-1);
    const startB = ptsB[0];

    const combos = [
      { d: dist(endA, startB),  pts: [...ptsA, ...ptsB],                  label: "A-end → B-start" },
      { d: dist(endA, endB),    pts: [...ptsA, ...[...ptsB].reverse()],   label: "A-end → B-end (B reversed)" },
      { d: dist(startA, startB),pts: [...[...ptsA].reverse(), ...ptsB],   label: "A-start → B-start (A reversed)" },
      { d: dist(startA, endB),  pts: [...[...ptsA].reverse(), ...[...ptsB].reverse()], label: "A-start → B-end (both reversed)" },
    ];

    const best = combos.reduce((a, b) => a.d < b.d ? a : b);

    pushToHistory();

    // Remove both originals, add merged road
    mapDataDraft.paths = mapDataDraft.paths.filter(p => p.id !== aId && p.id !== bId);
    const mergedId = slugify(name) + "_" + Date.now().toString().slice(-4);
    mapDataDraft.paths.push({ id: mergedId, name, points: best.pts });

    // Reset selectors and input
    document.getElementById("meMergeRoadA").value = "";
    document.getElementById("meMergeRoadB").value = "";
    document.getElementById("meMergeName").value = "";

    saveDraftToLocalStorage();
    renderAllLayers();
    updateMergeSelectors();
    showOk(`✓ Merged via ${best.label}. New road has ${best.pts.length} points.`);
    showStatus(`Roads merged into "${name}".`, "good");
  });
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

// ── Routing constants (must mirror campus-router.js) ────────────────────────
const CONNECT_TOLERANCE_M = 10;
const SNAP_DISTANCE_LIMIT_M = 180;
const EARTH_RADIUS_M = 6371e3;

// ── Snap indicator state ─────────────────────────────────────────────────────
let snapIndicatorCircle = null; // green circle shown when crosshair is near a node
let isRoadDrawingActive = false; // true while the road tab is active

// ── Route preview state ──────────────────────────────────────────────────────
let routePreviewLayer = null;
let routePreviewMarkers = [];

// ── Road extension state ─────────────────────────────────────────────────────
let extendingRoadId = null; // id of road being extended, null otherwise

// ── Mini routing engine (works on mapDataDraft, not live data) ───────────────

function _rDistM(a, b) {
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const hav = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function _ptKey(pt) {
  return `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
}

function _normalizePoint(pt) {
  if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
  if (pt && typeof pt === "object") return [Number(pt.lat), Number(pt.lng)];
  return [NaN, NaN];
}

function _buildDraftGraph() {
  const graph = { nodes: new Map(), segments: [] };

  function addNode(pt) {
    const key = _ptKey(pt);
    if (!graph.nodes.has(key)) graph.nodes.set(key, { key, point: pt, edges: new Map() });
    return graph.nodes.get(key);
  }

  function addEdge(a, b) {
    const d = _rDistM(a.point, b.point);
    if (!Number.isFinite(d) || d <= 0) return;
    if (!a.edges.has(b.key) || a.edges.get(b.key) > d) a.edges.set(b.key, d);
    if (!b.edges.has(a.key) || b.edges.get(a.key) > d) b.edges.set(a.key, d);
  }

  (mapDataDraft.paths || []).forEach(path => {
    const pts = (path.points || []).map(_normalizePoint).filter(([a, b]) => isFinite(a) && isFinite(b));
    for (let i = 1; i < pts.length; i++) {
      const fromNode = addNode(pts[i - 1]);
      const toNode = addNode(pts[i]);
      addEdge(fromNode, toNode);
      graph.segments.push({ fromNode, toNode });
    }
  });

  // Auto-connect near nodes within CONNECT_TOLERANCE_M
  const nodes = Array.from(graph.nodes.values());
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (_rDistM(nodes[i].point, nodes[j].point) <= CONNECT_TOLERANCE_M) {
        addEdge(nodes[i], nodes[j]);
      }
    }
  }

  return graph;
}

function _toXY(pt, origin) {
  const latScale = 111320;
  const lngScale = 111320 * Math.cos(origin[0] * Math.PI / 180);
  return { x: (pt[1] - origin[1]) * lngScale, y: (pt[0] - origin[0]) * latScale };
}

function _fromXY(xy, origin) {
  const latScale = 111320;
  const lngScale = 111320 * Math.cos(origin[0] * Math.PI / 180);
  return [origin[0] + xy.y / latScale, origin[1] + xy.x / lngScale];
}

function _closestOnSegment(pt, from, to) {
  const p = _toXY(pt, pt), a = _toXY(from, pt), b = _toXY(to, pt);
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const lenSq = ab.x ** 2 + ab.y ** 2;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / lenSq));
  const proj = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { point: _fromXY(proj, pt), dist: Math.hypot(p.x - proj.x, p.y - proj.y), ratio: t };
}

function _snapToGraph(graph, pt, id) {
  let nearestSeg = null, nearestDist = Infinity;
  graph.segments.forEach(seg => {
    const r = _closestOnSegment(pt, seg.fromNode.point, seg.toNode.point);
    if (r.dist < nearestDist) { nearestSeg = { ...seg, ...r }; nearestDist = r.dist; }
  });
  if (!nearestSeg || nearestDist > SNAP_DISTANCE_LIMIT_M) return { node: null, dist: nearestDist };
  if (nearestSeg.ratio <= 0.02) return { node: nearestSeg.fromNode, dist: nearestDist };
  if (nearestSeg.ratio >= 0.98) return { node: nearestSeg.toNode, dist: nearestDist };

  const key = `${id}:${_ptKey(nearestSeg.point)}`;
  const anchor = { key, point: nearestSeg.point, edges: new Map() };
  graph.nodes.set(key, anchor);
  function addEdge(a, b) {
    const d = _rDistM(a.point, b.point);
    if (Number.isFinite(d) && d > 0) { a.edges.set(b.key, d); b.edges.set(a.key, d); }
  }
  addEdge(anchor, nearestSeg.fromNode);
  addEdge(anchor, nearestSeg.toNode);
  return { node: anchor, dist: nearestDist };
}

function _dijkstra(graph, startKey, endKey) {
  const dist = new Map(), prev = new Map(), unvisited = new Set(graph.nodes.keys());
  graph.nodes.forEach((_, k) => dist.set(k, Infinity));
  dist.set(startKey, 0);
  while (unvisited.size > 0) {
    let cur = null, curDist = Infinity;
    unvisited.forEach(k => { if (dist.get(k) < curDist) { cur = k; curDist = dist.get(k); } });
    if (!cur || curDist === Infinity || cur === endKey) break;
    unvisited.delete(cur);
    graph.nodes.get(cur).edges.forEach((d, nk) => {
      if (!unvisited.has(nk)) return;
      const nd = curDist + d;
      if (nd < dist.get(nk)) { dist.set(nk, nd); prev.set(nk, cur); }
    });
  }
  if (startKey !== endKey && !prev.has(endKey)) return null;
  const path = []; let cursor = endKey;
  while (cursor) { path.unshift(cursor); cursor = prev.get(cursor); }
  return path.map(k => graph.nodes.get(k).point);
}

function _routeDist(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += _rDistM(pts[i - 1], pts[i]);
  return total;
}

/**
 * calculateDraftRoute — same algorithm as campus-router.js but reads from
 * mapDataDraft so the admin can preview routing before saving to Firestore.
 */
function calculateDraftRoute(fromInput, toInput) {
  const from = _normalizePoint(fromInput);
  const to = _normalizePoint(toInput);

  if (!isFinite(from[0]) || !isFinite(from[1]) || !isFinite(to[0]) || !isFinite(to[1])) {
    return { points: [from, to], distance: null, routed: false, reason: "Invalid coordinates", nodeCount: 0 };
  }

  const graph = _buildDraftGraph();
  if (graph.nodes.size === 0) {
    return { points: [from, to], distance: _routeDist([from, to]), routed: false, reason: "No roads drawn yet", nodeCount: 0 };
  }

  const start = _snapToGraph(graph, from, "start");
  const end   = _snapToGraph(graph, to,   "end");

  if (!start.node || !end.node) {
    const whichFailed = !start.node ? "origin" : "destination";
    const worstDist = Math.max(start.dist, end.dist);
    return {
      points: [from, to],
      distance: _routeDist([from, to]),
      routed: false,
      reason: `${whichFailed} is ${Math.round(worstDist)}m from the nearest road (limit: ${SNAP_DISTANCE_LIMIT_M}m)`,
      nodeCount: graph.nodes.size,
      snapDistOrigin: start.dist,
      snapDistDest: end.dist
    };
  }

  const path = _dijkstra(graph, start.node.key, end.node.key);
  if (!path || path.length === 0) {
    return {
      points: [from, to],
      distance: _routeDist([from, to]),
      routed: false,
      reason: "Road network is not connected between these points",
      nodeCount: graph.nodes.size
    };
  }

  const points = [from, ...path, to];
  return {
    points,
    distance: _routeDist(points),
    routed: true,
    reason: "Campus path route",
    nodeCount: graph.nodes.size,
    pathNodeCount: path.length
  };
}

// ── Road graph diagnostics ───────────────────────────────────────────────────

function runGraphDiagnostics() {
  const graph = _buildDraftGraph();
  const nodes = Array.from(graph.nodes.values());
  const nodeCount = nodes.length;
  const segCount = graph.segments.length;

  // Count isolated nodes (no edges)
  const isolatedNodes = nodes.filter(n => n.edges.size === 0);

  // Find connected components using BFS
  const visited = new Set();
  let components = 0;
  const componentSizes = [];

  nodes.forEach(startNode => {
    if (visited.has(startNode.key)) return;
    components++;
    const queue = [startNode.key];
    const componentMembers = [];
    while (queue.length > 0) {
      const key = queue.shift();
      if (visited.has(key)) continue;
      visited.add(key);
      componentMembers.push(key);
      const node = graph.nodes.get(key);
      if (node) node.edges.forEach((_, nk) => { if (!visited.has(nk)) queue.push(nk); });
    }
    componentSizes.push(componentMembers.length);
  });

  // Check how many ride stops snap within SNAP_DISTANCE_LIMIT_M
  const stops = [
    ...(mapDataDraft.rideStops || []).filter(s => s.lat != null),
    ...(mapDataDraft.locations || []).filter(l => l.lat != null)
  ];
  const snapWarnings = [];
  if (graph.segments.length > 0) {
    stops.forEach(stop => {
      const pt = [stop.lat, stop.lng];
      let minDist = Infinity;
      nodes.forEach(n => { const d = _rDistM(pt, n.point); if (d < minDist) minDist = d; });
      if (minDist > SNAP_DISTANCE_LIMIT_M) {
        snapWarnings.push({ name: stop.name, dist: Math.round(minDist) });
      }
    });
  }

  return { nodeCount, segCount, components, componentSizes, isolatedNodes, snapWarnings };
}

function renderDiagnostics() {
  const result = runGraphDiagnostics();

  document.getElementById("meDiagNodes").innerText = result.nodeCount;
  document.getElementById("meDiagSegments").innerText = result.segCount;

  const compEl = document.getElementById("meDiagComponents");
  compEl.innerText = result.components;
  compEl.style.color = result.components > 1 ? "#ef4444" : "#22c55e";

  const isoEl = document.getElementById("meDiagIsolated");
  isoEl.innerText = result.isolatedNodes.length;
  isoEl.style.color = result.isolatedNodes.length > 0 ? "#f59e0b" : "#22c55e";

  const warnEl = document.getElementById("meDiagWarnings");
  if (!warnEl) return;

  const lines = [];
  if (result.components > 1) {
    const sorted = [...result.componentSizes].sort((a, b) => b - a);
    lines.push(`<div class="me-diag-warn warn">⚠️ ${result.components} disconnected road island(s). Largest has ${sorted[0]} node(s). Roads must be connected for routing to work.</div>`);
  }
  if (result.snapWarnings.length > 0) {
    result.snapWarnings.forEach(w => {
      lines.push(`<div class="me-diag-warn warn">⚠️ "${w.name}" is ${w.dist}m from the nearest road — exceeds snap limit (${SNAP_DISTANCE_LIMIT_M}m). Routing will fall back to straight line.</div>`);
    });
  }
  if (result.nodeCount === 0) {
    lines.push(`<div class="me-diag-warn warn">⚠️ No roads drawn. Add roads in the Road tab first.</div>`);
  }
  if (lines.length === 0) {
    lines.push(`<div class="me-diag-warn ok">✓ Graph looks healthy. All stops are within snap range and the network is fully connected.</div>`);
  }

  warnEl.innerHTML = lines.join("");
}

// ── Route tab setup ──────────────────────────────────────────────────────────

function setupRouteTab() {
  // Populate dropdowns with all locations + stops that have coordinates
  populateRouteSelectors();

  document.getElementById("meRouteTestBtn")?.addEventListener("click", () => {
    const fromVal = document.getElementById("meRouteFrom").value;
    const toVal   = document.getElementById("meRouteTo").value;

    if (!fromVal || !toVal) {
      showStatus("Select both origin and destination first.", "warn");
      return;
    }
    if (fromVal === toVal) {
      showStatus("Origin and destination must be different.", "warn");
      return;
    }

    // Look up the [lat, lng] for each selection
    const allPoints = getAllRoutePoints();
    const from = allPoints.find(p => p.id === fromVal);
    const to   = allPoints.find(p => p.id === toVal);
    if (!from || !to) return;

    // Clear old preview
    clearRoutePreview();

    const result = calculateDraftRoute([from.lat, from.lng], [to.lat, to.lng]);

    // Draw the route line
    routePreviewLayer = L.polyline(result.points, {
      color: result.routed ? "#22c55e" : "#ef4444",
      weight: 5,
      opacity: 0.85,
      dashArray: result.routed ? null : "10, 8",
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    // From/to markers
    routePreviewMarkers.push(
      L.circleMarker([from.lat, from.lng], { radius: 8, color: "#fff", fillColor: "#3b82f6", fillOpacity: 1, weight: 2 })
        .addTo(map).bindTooltip(from.name, { permanent: true, direction: "top" }),
      L.circleMarker([to.lat, to.lng],   { radius: 8, color: "#fff", fillColor: "#22c55e", fillOpacity: 1, weight: 2 })
        .addTo(map).bindTooltip(to.name,   { permanent: true, direction: "top" })
    );

    // Fit map to route
    map.fitBounds(L.latLngBounds(result.points), { padding: [40, 40] });

    // Show result card
    const resultEl = document.getElementById("meRouteResult");
    const badgeEl  = document.getElementById("meRouteBadge");
    const statsEl  = document.getElementById("meRouteStats");

    if (!resultEl || !badgeEl || !statsEl) return;

    resultEl.classList.remove("hidden");
    badgeEl.innerHTML = result.routed
      ? `<span class="me-route-badge--ok"><i class="fas fa-check-circle"></i> Routed via campus roads</span>`
      : `<span class="me-route-badge--fail"><i class="fas fa-triangle-exclamation"></i> Straight-line fallback</span>`;

    const distText = result.distance != null
      ? result.distance >= 1000
        ? `${(result.distance / 1000).toFixed(2)} km`
        : `${Math.round(result.distance)} m`
      : "N/A";

    const snapOriginText = result.snapDistOrigin != null ? `${Math.round(result.snapDistOrigin)}m` : "—";
    const snapDestText   = result.snapDistDest   != null ? `${Math.round(result.snapDistDest)}m`   : "—";

    statsEl.innerHTML = `
      <div class="me-diag-grid">
        <div class="me-diag-item"><span class="me-diag-label">Distance</span><strong class="me-diag-value">${distText}</strong></div>
        <div class="me-diag-item"><span class="me-diag-label">Graph nodes</span><strong class="me-diag-value">${result.nodeCount ?? "—"}</strong></div>
        <div class="me-diag-item"><span class="me-diag-label">Path nodes</span><strong class="me-diag-value">${result.pathNodeCount ?? (result.routed ? "—" : "0")}</strong></div>
        <div class="me-diag-item"><span class="me-diag-label">Snap (origin)</span><strong class="me-diag-value" style="color:${result.snapDistOrigin > SNAP_DISTANCE_LIMIT_M ? '#ef4444' : 'inherit'}">${snapOriginText}</strong></div>
        <div class="me-diag-item"><span class="me-diag-label">Snap (dest)</span><strong class="me-diag-value" style="color:${result.snapDistDest > SNAP_DISTANCE_LIMIT_M ? '#ef4444' : 'inherit'}">${snapDestText}</strong></div>
        <div class="me-diag-item"><span class="me-diag-label">Reason</span><strong class="me-diag-value" style="font-size:11px;">${result.reason}</strong></div>
      </div>
    `;

    showStatus(result.routed ? "Route found via campus roads." : `No road route: ${result.reason}`, result.routed ? "good" : "warn");
  });

  document.getElementById("meRouteClearBtn")?.addEventListener("click", () => {
    clearRoutePreview();
    const resultEl = document.getElementById("meRouteResult");
    if (resultEl) resultEl.classList.add("hidden");
    showStatus("Route preview cleared.");
  });

  document.getElementById("meRunDiagBtn")?.addEventListener("click", () => {
    renderDiagnostics();
    showStatus("Diagnostics updated.", "good");
  });
}

function getAllRoutePoints() {
  const out = [];
  (mapDataDraft.rideStops || []).forEach(s => {
    if (s.lat != null) out.push({ id: `stop:${s.id}`, name: `🚏 ${s.name}`, lat: s.lat, lng: s.lng });
  });
  (mapDataDraft.locations || []).forEach(l => {
    if (l.lat != null) out.push({ id: `loc:${l.id}`, name: l.name, lat: l.lat, lng: l.lng });
  });
  return out;
}

function populateRouteSelectors() {
  const fromEl = document.getElementById("meRouteFrom");
  const toEl   = document.getElementById("meRouteTo");
  if (!fromEl || !toEl) return;

  const pts = getAllRoutePoints();
  const opts = pts.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  fromEl.innerHTML = `<option value="">— select origin —</option>${opts}`;
  toEl.innerHTML   = `<option value="">— select destination —</option>${opts}`;
}

function clearRoutePreview() {
  if (routePreviewLayer && map) {
    try { map.removeLayer(routePreviewLayer); } catch (e) { /* ok */ }
  }
  routePreviewLayer = null;
  routePreviewMarkers.forEach(m => { try { map.removeLayer(m); } catch (e) { /* ok */ } });
  routePreviewMarkers = [];
}

// ── Junction snap indicator (road drawing mode) ──────────────────────────────

function setupSnapIndicator() {
  // Run whenever the map moves while road tab is active
  map.on("move", () => {
    if (!isRoadDrawingActive) return;
    updateSnapIndicator();
  });
}

function updateSnapIndicator() {
  const center = map.getCenter();
  const pt = [center.lat, center.lng];

  // Find closest existing road node
  const graph = _buildDraftGraph();
  const nodes = Array.from(graph.nodes.values());

  let closestNode = null, closestDist = Infinity;
  nodes.forEach(n => {
    const d = _rDistM(pt, n.point);
    if (d < closestDist) { closestNode = n; closestDist = d; }
  });

  if (closestNode && closestDist <= CONNECT_TOLERANCE_M) {
    // Within snap range — show green indicator
    if (!snapIndicatorCircle) {
      snapIndicatorCircle = L.circle(closestNode.point, {
        radius: CONNECT_TOLERANCE_M,
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.18,
        weight: 2,
        dashArray: "4, 4",
        interactive: false
      }).addTo(map);
    } else {
      snapIndicatorCircle.setLatLng(closestNode.point);
    }
    showStatus(`Snap junction detected! (${Math.round(closestDist)}m away — point will auto-connect)`, "good");
  } else {
    clearSnapIndicator();
  }
}

function clearSnapIndicator() {
  if (snapIndicatorCircle && map) {
    try { map.removeLayer(snapIndicatorCircle); } catch (e) { /* ok */ }
  }
  snapIndicatorCircle = null;
}

// ── Road extension logic ─────────────────────────────────────────────────────

/**
 * Called from a road popup's Extend button.
 * Loads the road's existing points into activeRoadPoints, switches to the Road
 * tab, and removes the road from the draft (it will be re-saved with extra points).
 */
function startRoadExtension(roadId) {
  const roadIndex = mapDataDraft.paths.findIndex(p => p.id === roadId);
  if (roadIndex === -1) return;

  const road = mapDataDraft.paths[roadIndex];
  if (!road || !Array.isArray(road.points) || road.points.length < 2) return;

  // Normalize points to [lat, lng] arrays
  const normalizedPoints = road.points.map(pt => {
    if (Array.isArray(pt)) return [Number(pt[0].toFixed(6)), Number(pt[1].toFixed(6))];
    return [Number(pt.lat.toFixed(6)), Number(pt.lng.toFixed(6))];
  });

  // Set road name in input
  const nameInput = document.getElementById("meRoadName");
  if (nameInput) nameInput.value = road.name;

  // Remember which road we're extending so save can handle it
  extendingRoadId = roadId;

  // Switch to Road tab
  const roadTab = document.querySelector('.me-tab[data-tab="road"]');
  if (roadTab) roadTab.click();

  // Inject the existing points (the road drawing logic uses module-scoped vars,
  // so we dispatch a custom event to avoid coupling)
  document.dispatchEvent(new CustomEvent("me:extendRoad", { detail: { points: normalizedPoints, name: road.name } }));

  showStatus(`Extending road: "${road.name}" — ${normalizedPoints.length} existing points loaded.`, "good");
}

// Expose globally so popup onclick can reach it
window.meStartRoadExtension = startRoadExtension;
