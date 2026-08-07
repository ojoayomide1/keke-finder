import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc,
  getDoc,
  getDocs,
  where,
  db,
  auth,
  addDoc,
  serverTimestamp,
  deleteUser
} from "./firebase.js";
import { initAuth } from "./auth.js";
import "./seeding.js";
import { state } from "./modules/state.js";
import {
  CAMPUS_CATEGORY_META,
  getCampusDestinationLocations,
  loadCampusDataFromFirestore
} from "./campus-data.js";
import { 
  showToast, 
  updateBottomSheet, 
  updateRideDetails, 
  toggleControls, 
  setButtonVisible,
  showLoginScreen,
  initSplashScreen,
  showConfirmDialog
} from "./modules/ui.js";

// start the splash first before anything else loads
initSplashScreen();
import { 
  initMap, 
  animateMarker, 
  getDistance,
  stabilizeLocation,
  refreshMapTheme
} from "./modules/map-manager.js";
import { calculateCampusRoute } from "./modules/campus-router.js";
import { 
  populateLocations, 
  updateStudentProfileUI, 
  fetchRideHistory,
  requestKeke as _requestKeke,
  cancelRide as _cancelRide
} from "./modules/student.js";
import { 
  updateRiderDashboardUI, 
  updateAvailableRidesList, 
  updateRiderControls,
  drainWaitingQueueForRide,
  listenToActiveRide,
  completeRide as _completeRide
} from "./modules/rider.js";
import { startScheduledRidesProcessor } from "./modules/scheduled-rides.js";
import { listenToStudentWallet, renderStudentWallet, formatNaira } from "./wallet.js";
import { listenToRiderWallet, renderRiderWallet } from "./riderWallet.js";

const THEME_STORAGE_KEY = "oprTheme";

const pathfinderStudentIcon = L.divIcon({
  html: `
    <div class="pathfinder-student-marker">
      <i class="fas fa-person-walking"></i>
    </div>
  `,
  className: "",
  iconSize: [38, 38],
  iconAnchor: [19, 19],
  popupAnchor: [0, -18]
});

// Custom Leaflet DivIcons — made these look nice for the map
const pickupPinIcon = L.divIcon({
  html: '<div class="custom-pin pin-pickup"><i class="fas fa-arrow-down-long"></i></div>',
  className: 'custom-leaflet-pin',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

const dropoffPinIcon = L.divIcon({
  html: '<div class="custom-pin pin-dropoff"><i class="fas fa-flag"></i></div>',
  className: 'custom-leaflet-pin',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

const riderKekeIcon = L.divIcon({
  html: '<div class="custom-pin pin-keke"><i class="fas fa-motorcycle"></i></div>',
  className: 'custom-leaflet-pin pin-keke-container',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18]
});

function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("light-theme", isLight);
  document.querySelectorAll("[data-theme-toggle]").forEach(toggle => {
    toggle.checked = !isLight;
  });
  try {
    localStorage.setItem(THEME_STORAGE_KEY, isLight ? "light" : "dark");
  } catch (err) {
    console.warn("Unable to save theme preference:", err);
  }
  refreshMapTheme();
}

function initTheme() {
  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "light";
  } catch (err) {
    console.warn("Unable to read theme preference:", err);
  }
  applyTheme(savedTheme === "dark" ? "dark" : "light");
}

function toggleAppTheme(checked) {
  applyTheme(checked ? "dark" : "light");
}

initTheme();

// ===== GLOBALS =====
function toggleSidebar() {
  const sidebar = document.getElementById("studentSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar || !overlay) return;
  renderSidebarMenu();
  const isHidden = sidebar.classList.contains("hidden");
  sidebar.classList.toggle("hidden", !isHidden);
  overlay.classList.toggle("hidden", !isHidden);
}

function closeSidebar() {
  document.getElementById("studentSidebar")?.classList.add("hidden");
  document.getElementById("sidebarOverlay")?.classList.add("hidden");
}

function renderSidebarMenu() {
  const nav = document.getElementById("sidebarNav");
  if (!nav) return;

  const role = state.currentRole || "student";
  const nameEl = document.getElementById("sidebarName");
  const emailEl = document.getElementById("sidebarEmail");
  if (nameEl) nameEl.innerText = state.currentUser?.displayName || state.currentUser?.name || "User";
  if (emailEl) emailEl.innerText = state.currentUser?.email || (role === "rider" ? "Rider account" : "Student account");
  const items = role === "rider"
    ? [
        ["home", "fa-house", "Home"],
        ["earnings", "fa-money-bill-wave", "Earnings"],
        ["live", "fa-satellite-dish", "Live Map"],
        ["profile", "fa-user", "Profile"]
      ]
    : [
        ["home", "fa-house", "Home"],
        ["wallet", "fa-wallet", "Wallet"],
        ["live", "fa-satellite-dish", "Live Map"],
        ["map", "fa-map-location-dot", "Pathfinder"],
        ["profile", "fa-user", "Profile"]
      ];

  if (state.currentUser?.isAdmin) {
    items.push(["admin", "fa-shield-halved", "Admin"]);
  }

  nav.innerHTML = items.map(([tab, icon, label]) => `
    <button type="button" class="nav-item-sidebar" onclick="${tab === "admin" ? "window.location.href='/admin.html'" : `switchTab('${tab}')`}">
      <i class="fas ${icon}"></i>
      <span>${label}</span>
    </button>
  `).join("") + `
    <div class="nav-divider"></div>
    <button type="button" class="nav-item-sidebar logout" onclick="logout()">
      <i class="fas fa-right-from-bracket"></i>
      <span>Logout</span>
    </button>
  `;
}

function setCampusActivityValue(elementId, value) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = value;
}

function stopCampusActivityListeners() {
  if (state.campusActivityUnsubscribeRides) state.campusActivityUnsubscribeRides();
  if (state.campusActivityUnsubscribeQueue) state.campusActivityUnsubscribeQueue();
  state.campusActivityUnsubscribeRides = null;
  state.campusActivityUnsubscribeQueue = null;
}

function startCampusActivityListeners() {
  stopCampusActivityListeners();
  setCampusActivityValue("onlineKekesCount", "...");
  setCampusActivityValue("waitingStudentsCount", "...");

  state.campusActivityUnsubscribeRides = onSnapshot(
    query(collection(db, "rides"), where("status", "in", ["waiting", "active"])),
    (snapshot) => {
      setCampusActivityValue("onlineKekesCount", snapshot.size);
    },
    (err) => {
      console.warn("Campus online rider count unavailable:", err.code || err.message);
      setCampusActivityValue("onlineKekesCount", "--");
    }
  );

  // students don't have access to waitingQueue directly so i'm using queued ride requests instead
  state.campusActivityUnsubscribeQueue = onSnapshot(
    query(collection(db, "rideRequests"), where("status", "==", "queued")),
    (snapshot) => {
      setCampusActivityValue("waitingStudentsCount", snapshot.size);
    },
    (err) => {
      console.warn("Campus waiting student count unavailable:", err.code || err.message);
      setCampusActivityValue("waitingStudentsCount", "--");
    }
  );
}
function switchTab(tab) {
  const role = state.currentRole || "student";

  const studentViews = {
    home: "studentDashboard",
    wallet: "walletView",
    topup: "topUpView",
    transfer: "transferDetailsView",
    "topup-waiting": "topUpWaitingView",
    live: "liveRideView",
    map: "pathfinderView",
    profile: "profileView",
    activity: "activityView"
  };

  const riderViews = {
    home: "riderDashboard",
    earnings: "riderEarningsView",
    withdraw: "riderWithdrawalView",
    live: "riderLiveView",
    profile: "riderProfileView"
  };

  const views = role === "student" ? studentViews : riderViews;

  if (role === "student" && tab !== "map") {
    stopPathfinderWatch();
  }

  // fade out the current tab before showing the new one
  const currentViewIds = [...Object.values(studentViews), ...Object.values(riderViews)];
  const visibleView = currentViewIds.map(vId => document.getElementById(vId)).find(el => el && !el.classList.contains("hidden"));
  if (visibleView && visibleView.id !== views[tab]) {
    visibleView.classList.add("tab-fade-out");
    setTimeout(() => {
      visibleView.classList.add("hidden");
      visibleView.classList.remove("tab-fade-out");
    }, 150);
    // hide every other view too
    currentViewIds.forEach(vId => {
      const el = document.getElementById(vId);
      if (el && el !== visibleView) el.classList.add("hidden");
    });
  } else {
    currentViewIds.forEach(vId => {
      const el = document.getElementById(vId);
      if (el) el.classList.add("hidden");
    });
  }

  // Handle specific tab logic
  if (role === "student") {
    if (tab === "activity") {
      if (!state.currentUser?.uid) return showToast("Login required to view activity", "error");
      fetchRideHistory();
    } else if (tab === "wallet") {
      renderStudentWallet();
    } else if (tab === "map") {
      populateCampusMapLandmarks();
      resetPathfinder();
    } else if (tab === "live") {
      setTimeout(() => {
        if (!state.map) {
          initMap("studentMap");
        } else {
          state.map.invalidateSize();
        }
        if (state.latestRide) window.updateRideUI(state.latestRide);
      }, 100);
    }
  } else if (role === "rider") {
    if (tab === "profile") {
      updateRiderProfileUI();
    } else if (tab === "earnings" || tab === "withdraw") {
      renderRiderWallet();
    } else if (tab === "live") {
      setTimeout(() => {
        if (!state.map) {
          initMap("riderMap");
        } else {
          state.map.invalidateSize();
        }
        if (state.latestRide) window.updateRideUI(state.latestRide);
        if (state.currentRideId) {
          const riderSheet = document.getElementById("riderSheet");
          riderSheet?.classList.remove("hidden", "expanded");
          riderSheet?.classList.add("minimized");
        }
      }, 100);
    }
  }

  // show the new tab with a fade in
  const targetView = views[tab];
  if (targetView) {
    const targetEl = document.getElementById(targetView);
    targetEl.classList.remove("hidden");
    targetEl.classList.add("tab-fade-in");
    setTimeout(() => targetEl.classList.remove("tab-fade-in"), 300);
  }

  closeSidebar();

  // update the active tab highlight + move the pill
  const pillId = role === "student" ? "studentNavPill" : "riderNavPill";
  const activeTabEl = document.querySelector(`#${role === "student" ? "studentUI" : "riderUI"} .nav-tab[onclick*="${tab}"]`);
  const navSelector = role === "student" ? "#studentUI .nav-tab" : "#riderUI .nav-tab";
  document.querySelectorAll(navSelector).forEach(t => {
    const tId = t.id.replace("tab-", "").replace("rider-", "");
    t.classList.toggle("active", tId === tab);
  });
  updateNavPill(pillId, activeTabEl);

  // show or hide the dot on the live tab
  updateLiveNotifDot(role);

  // also update the balance glow thing
  updateBalanceChipGlow(role);
}

function setProfileText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function getProfileInitials(name, fallback = "OP") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");
}

function getNameGradient(name) {
  const source = String(name || "OpRides");
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = source.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 72%, 46%), hsl(${(hue + 52) % 360}, 78%, 58%))`;
}

// ===== NAV PILL ANIMATION =====
function updateNavPill(pillId, activeTabEl) {
  const pill = document.getElementById(pillId);
  if (!pill || !activeTabEl) return;

  const nav = pill.parentElement;
  if (!nav) return;

  const navRect = nav.getBoundingClientRect();
  const tabRect = activeTabEl.getBoundingClientRect();

  const left = tabRect.left - navRect.left;
  const width = tabRect.width;

  pill.style.left = `${left}px`;
  pill.style.width = `${width}px`;
}

// set the pill position on page load
function initNavPills() {
  const role = state.currentRole || "student";
  const pillId = role === "student" ? "studentNavPill" : "riderNavPill";
  const navSelector = role === "student" ? "#studentUI .nav-tab.active" : "#riderUI .nav-tab.active";
  const activeTab = document.querySelector(navSelector);
  if (activeTab) {
    updateNavPill(pillId, activeTab);
  }
}

// if screen size changes, reposition the pill
window.addEventListener("resize", () => {
  initNavPills();
});

// ===== NOTIFICATION DOT =====
function updateLiveNotifDot(role) {
  const dotId = role === "student" ? "studentLiveNotifDot" : "riderLiveNotifDot";
  const dot = document.getElementById(dotId);
  if (!dot) return;

  const hasActiveRide = !!state.currentRideId;
  dot.classList.toggle("visible", hasActiveRide);
}

// ===== BALANCE CHIP GLOW =====
function updateBalanceChipGlow(role) {
  const chipSelector = role === "student"
    ? "#studentUI .balance-chip"
    : "#riderUI .balance-chip";
  const chip = document.querySelector(chipSelector);
  if (!chip) return;

  const balanceEl = chip.querySelector(".balance-amount");
  if (!balanceEl) return;

  const balanceText = balanceEl.textContent.replace(/[^\d]/g, "");
  const balance = parseInt(balanceText, 10) || 0;

  // glow red if below 500 naira
  chip.classList.toggle("is-low", balance < 500);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function estimateRideEtaMinutes(ride) {
  const pendingStops = (ride.stopQueue || []).filter(stop => stop.status === "pending");
  const currentLocation = ride.currentLocation;
  if (!currentLocation || !pendingStops.length) return null;
  const nextStop = pendingStops[0];
  if (!nextStop?.location) return null;
  const distance = getDistance(currentLocation.lat, currentLocation.lng, nextStop.location.lat, nextStop.location.lng);
  return Math.max(1, Math.round(distance / 80));
}

function renderLiveSheetEnhancements(ride) {
  const role = state.currentRole || "student";
  const target = role === "rider" ? "riderSheetDetails" : "studentRideDetails";
  const details = document.getElementById(target);
  if (!details || !ride) return;

  const pendingStops = (ride.stopQueue || []).filter(stop => stop.status === "pending");
  const nextStop = pendingStops[0];
  const etaMinutes = estimateRideEtaMinutes(ride);
  const riderName = ride.riderName || state.currentUser?.displayName || "Campus rider";
  const plate = ride.plateNo || state.currentUser?.plateNo || "Campus plate";
  const vehicle = formatVehicleType(ride.vehicleType || state.currentUser?.vehicleType || "keke");
  const statusLabel = ride.status === "waiting"
    ? "Waiting for students"
    : role === "student"
      ? "Rider en route"
      : nextStop ? `Next ${nextStop.type === "pickup" ? "pickup" : "drop-off"}` : "Route clear";

  const etaLabel = etaMinutes == null
    ? (ride.status === "waiting" ? "Waiting" : "Calculating")
    : `${etaMinutes} min`;

  const premiumHtml = `
    <div class="rider-info-row">
      <div class="rider-avatar">${escapeHtml(getProfileInitials(riderName, "OP"))}</div>
      <div class="rider-info-details">
        <strong>${escapeHtml(riderName)}</strong>
        <span>${escapeHtml(plate)} · ${escapeHtml(vehicle)}</span>
      </div>
      <div class="rider-vehicle-badge"><i class="fas fa-motorcycle"></i>${escapeHtml(vehicle)}</div>
    </div>
    <div class="eta-countdown ${ride.status === "waiting" ? "is-waiting" : ""}">
      <div class="eta-icon"><i class="fas fa-clock"></i></div>
      <div class="eta-text">
        <strong>${escapeHtml(etaLabel)}</strong>
        <span>${escapeHtml(nextStop?.locationLabel || statusLabel)}</span>
      </div>
      <div class="status-text-animated"><span class="status-dot"></span>${escapeHtml(statusLabel)}</div>
    </div>
  `;

  details.querySelectorAll(".rider-info-row, .eta-countdown").forEach(el => el.remove());
  details.insertAdjacentHTML("afterbegin", premiumHtml);
}
// ===== RIPPLE EFFECT =====
function initRippleEffect() {
  document.addEventListener("click", (e) => {
    const rippleTarget = e.target.closest(
      "button:not(.iconBtn):not(.nav-tab):not(.toast-close-btn), .card-tappable, .card-student, .card-rider, .role-select-card"
    );
    if (!rippleTarget) return;

    // don't add another ripple if one is already going
    if (rippleTarget.querySelector(".ripple-circle")) return;

    rippleTarget.classList.add("ripple-effect");
    const ripple = document.createElement("span");
    ripple.className = "ripple-circle";

    const rect = rippleTarget.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

    rippleTarget.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });
}

// ===== BALANCE COUNTER ANIMATION =====
function animateBalanceCounter(elementId, targetValue) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const currentText = el.textContent.replace(/[^\d]/g, "");
  const current = parseInt(currentText, 10) || 0;
  const target = parseInt(targetValue, 10) || 0;
  if (current === target) return;

  const duration = 600;
  const start = performance.now();

  el.classList.add("balance-animate");

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease out so it slows down nicely at the end
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(current + (target - current) * eased);

    if (el.id.startsWith("header-balance")) {
      el.textContent = value;
    } else {
      el.textContent = formatNaira(value);
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.classList.remove("balance-animate");
    }
  }

  requestAnimationFrame(step);
}

// kick off ripple on startup
initRippleEffect();

// ===== ROLE SELECT =====
function selectRole(role) {
  state.currentRole = role;
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.classList.add("screen-fade-out");
    setTimeout(() => {
      roleSelect.classList.add("hidden");
      roleSelect.classList.remove("screen-fade-out");
    }, 400);
  }
  if (role === "student") {
    document.getElementById("studentUI")?.classList.remove("hidden");
  } else {
    document.getElementById("riderUI")?.classList.remove("hidden");
  }
  // position the pill for whichever role was picked
  setTimeout(() => initNavPills(), 50);
}
window.selectRole = selectRole;

function formatVehicleType(type) {
  const normalized = String(type || "keke").toLowerCase();
  if (normalized === "shuttle") return "Shuttle";
  if (normalized === "bike") return "Bike";
  return "Keke";
}

async function renderRiderProfileStats() {
  if (!state.currentUser?.uid) return;
  try {
    const ridesSnap = await getDocs(query(
      collection(db, "rides"),
      where("riderId", "==", state.currentUser.uid)
    ));
    const rides = ridesSnap.docs.map(docSnap => docSnap.data()).filter(ride => ride.status === "completed");
    const earned = state.currentUser.earnings?.totalEarned || 0;

    setProfileText("riderProfileTotalRides", String(rides.length));
    setProfileText("riderProfileTotalEarned", formatNaira(earned));
  } catch (err) {
    console.warn("Rider profile stats unavailable:", err.code || err.message);
    setProfileText("riderProfileTotalRides", "--");
  }
}

function updateRiderProfileUI() {
  if (!state.currentUser) return;
  const user = state.currentUser;
  const name = user.displayName || user.name || "Rider";
  const email = user.email || "No email";
  const avatar = document.getElementById("riderProfileAvatar");
  const statusEl = document.getElementById("riderProfileStatus");
  const isOnline = Boolean(state.currentRideId || state.riderDocId || state.riderWatchId);

  setProfileText("riderProfileName", name);
  setProfileText("riderProfileEmail", email);
  setProfileText("riderProfilePlate", user.plateNo || "No Plate");
  setProfileText("riderProfileVehicle", formatVehicleType(user.vehicleType));
  setProfileText("riderProfileStatus", isOnline ? "Online" : "Offline");
  if (statusEl) statusEl.classList.toggle("online", isOnline);
  if (avatar) {
    avatar.innerText = getProfileInitials(name, "RD");
    avatar.style.background = getNameGradient(name);
  }
  renderRiderProfileStats();

  const adminLink = document.getElementById("adminLinkRider");
  if (adminLink) {
    adminLink.classList.toggle("hidden", !user.isAdmin);
  }
}

function switchStudentView(view) {
  // Map old view names to new tabs if called from other modules
  const viewMap = {
    dashboard: "home",
    pathfinder: "map",
    activity: "activity",
    profile: "profile"
  };
  switchTab(viewMap[view] || view);
}

function showMap() {
  switchTab('live');
}

function hideMap() {
  switchTab('home');
}

function hideRiderMap() {
  document.getElementById("riderDashboard")?.classList.remove("hidden");
  document.getElementById("riderLiveView")?.classList.add("hidden");
  document.getElementById("riderSheet")?.classList.add("hidden");
}

async function requestKeke() {
  await _requestKeke();
  startListeners();
}

async function cancelRide() {
  await _cancelRide();
  state.currentRideId = null;
  updateLiveNotifDot(state.currentRole);
}

async function completeRide() {
  await _completeRide();
  state.currentRideId = null;
  updateLiveNotifDot(state.currentRole);
}

async function cleanupRiderSession(previousUser = state.currentUser) {
  if (previousUser?.role !== "rider" || !state.riderDocId || state.riderDocId === "creating...") return;

  try {
    const rideRef = doc(db, "rides", state.riderDocId);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) return;

    const ride = rideSnap.data();
    const hasPassengers = (ride.seats?.occupied || 0) > 0 || Object.keys(ride.passengers || {}).length > 0;
    if (ride.riderId === previousUser.uid && ride.status === "waiting" && !hasPassengers) {
      await updateDoc(rideRef, {
        status: "completed",
        updatedAt: serverTimestamp()
      });
    }
  } catch (err) {
    console.warn("Failed to clean up rider session:", err);
  }
}

function stopPathfinderWatch() {
  if (state.pathfinderWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.pathfinderWatchId);
  }
  state.pathfinderWatchId = null;
  state.lastStudentLoc = null;
  state.pathfinderDestinationId = null;
  state.pathfinderHasFitRoute = false;
}

function clearRouteLayer() {
  if (state.routeLayer && state.map) {
    try { state.map.removeLayer(state.routeLayer); } catch (e) { console.warn("Route cleanup warning:", e); }
  }
  state.routeLayer = null;
}

function drawCampusRoute(points, style = {}) {
  if (!state.map || !Array.isArray(points) || points.length < 2) return;

  clearRouteLayer();

  // White outline behind the coloured line so it punches through tile roads
  const outlineLayer = L.polyline(points, {
    color: "#ffffff",
    weight: (style.weight || 6) + 4,
    opacity: 0.85,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(state.map);

  const fillLayer = L.polyline(points, {
    color: style.color || "#3b82f6",
    weight: style.weight || 6,
    opacity: style.opacity || 0.9,
    dashArray: style.dashArray || null,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);

  // Group both into a single removable layer via a LayerGroup
  state.routeLayer = L.layerGroup([outlineLayer, fillLayer]).addTo(state.map);
}

function updatePathfinderRouteFromPosition(pos, landmark, watchId) {
  if (state.pathfinderWatchId !== watchId || state.pathfinderDestinationId !== landmark.id || !state.map) return;

  const { latitude, longitude, accuracy } = pos.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  if (accuracy && accuracy > 120) {
    updatePathfinderSheet(landmark, null, null, "Weak GPS signal...");
    return;
  }

  const studentLoc = stabilizeLocation(latitude, longitude);
  const distanceMoved = state.lastStudentLoc
    ? getDistance(state.lastStudentLoc.lat, state.lastStudentLoc.lng, studentLoc.lat, studentLoc.lng)
    : Infinity;

  if (distanceMoved < 2 && state.userMarker) return;
  state.lastStudentLoc = studentLoc;

  const distance = getDistance(studentLoc.lat, studentLoc.lng, landmark.lat, landmark.lng);

  if (!state.userMarker) {
    state.userMarker = L.marker([studentLoc.lat, studentLoc.lng], { icon: pathfinderStudentIcon }).addTo(state.map).bindPopup("Your Location");
  } else {
    animateMarker(state.userMarker, studentLoc.lat, studentLoc.lng, 700);
  }

  const route = calculateCampusRoute(
    [studentLoc.lat, studentLoc.lng],
    [landmark.lat, landmark.lng]
  );
  const routeDistance = route.distance ?? distance;
  const etaMinutes = Math.max(1, Math.round(routeDistance / 80));
  drawCampusRoute(route.points, {
    color: "#3b82f6",
    weight: 6,
    dashArray: route.routed ? null : "8, 10"
  });

  if (!state.pathfinderHasFitRoute) {
    state.map.fitBounds(L.latLngBounds(route.points), { padding: [50, 50] });
    state.pathfinderHasFitRoute = true;
    showToast(`Pathfinding to ${landmark.name}`);
  }

  updatePathfinderSheet(landmark, routeDistance, etaMinutes, route.routed ? "Campus route tracking" : route.reason);
}

async function navigateToLandmark(landmarkId) {
  if (!landmarkId) return;
  const landmark = getCampusDestinationLocations().find(l => l.id === landmarkId);
  if (!landmark) return;
  stopPathfinderWatch();

  document.getElementById("pathfinderSelectPanel")?.classList.add("hidden");
  document.getElementById("pathfinderMapPanel")?.classList.remove("hidden");
  const sheet = document.getElementById("pathfinderSheet");
  sheet?.classList.remove("hidden", "expanded");
  sheet?.classList.add("minimized");
  updatePathfinderSheet(landmark, null, null, "Calculating route...");

  initMap("pathfinderMap");

  if (!navigator.geolocation) {
    L.marker([landmark.lat, landmark.lng]).addTo(state.map).bindPopup(landmark.name).openPopup();
    state.map.setView([landmark.lat, landmark.lng], 17);
    updatePathfinderSheet(landmark, null, null, "GPS unavailable");
    showToast("GPS unavailable. Showing destination only.", "warning");
    return;
  }

  state.pathfinderDestinationId = landmark.id;
  let pathfinderWatchId = null;
  pathfinderWatchId = navigator.geolocation.watchPosition((pos) => {
    updatePathfinderRouteFromPosition(pos, landmark, pathfinderWatchId);
  }, (err) => {
    if (state.pathfinderDestinationId !== landmark.id || !state.map) return;
    L.marker([landmark.lat, landmark.lng]).addTo(state.map).bindPopup(landmark.name).openPopup();
    state.map.setView([landmark.lat, landmark.lng], 17);
    updatePathfinderSheet(landmark, null, null, "GPS unavailable");
    showToast("GPS unavailable. Showing destination only.", "warning");
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
  state.pathfinderWatchId = pathfinderWatchId;
}

function updatePathfinderSheet(landmark, distance, etaMinutes, status) {
  const title = document.getElementById("pathfinderTitle");
  const sub = document.getElementById("pathfinderSub");
  const details = document.getElementById("pathfinderDetails");

  if (title) title.innerText = landmark.name;
  if (sub) sub.innerText = status;
  if (!details) return;

  const distanceText = distance == null
    ? "Unavailable"
    : distance >= 1000
      ? `${(distance / 1000).toFixed(1)} km`
      : `${Math.round(distance)} m`;

  details.innerHTML = [
    { label: "Destination", value: landmark.name },
    { label: "ETA", value: etaMinutes == null ? "Enable GPS" : `${etaMinutes} min` },
    { label: "Distance", value: distanceText },
    { label: "Mode", value: "Walking route" }
  ].map(d => `<div class="ride-detail"><span>${d.label}</span><strong>${d.value}</strong></div>`).join("");
}

function resetPathfinder() {
  stopPathfinderWatch();
  document.getElementById("pathfinderMapPanel")?.classList.add("hidden");
  document.getElementById("pathfinderSheet")?.classList.add("hidden");
  document.getElementById("pathfinderSelectPanel")?.classList.remove("hidden");
  const select = document.getElementById("pathfinderSelect");
  if (select) select.value = "";
  if (state.map) {
    try { state.map.remove(); } catch (e) { console.warn("Pathfinder map cleanup warning:", e); }
  }
  state.map = null;
  state.userMarker = null;
  state.routeLayer = null;
  state.requestMarkers = [];
  state.lastRenderedLocation = null;
}

function completePathfinderSession() {
  resetPathfinder();
  showToast("Walking session completed", "success");
}

function populateCampusMapLandmarks() {
  const select = document.getElementById("pathfinderSelect");
  if (!select) return;

  const categoryLabels = Object.fromEntries(
    Object.entries(CAMPUS_CATEGORY_META).map(([key, meta]) => [key, meta.label])
  );

  const grouped = getCampusDestinationLocations()
    .slice()
    .sort((a, b) => {
      const categorySort = (categoryLabels[a.category] || "Other").localeCompare(categoryLabels[b.category] || "Other");
      return categorySort || a.name.localeCompare(b.name);
    })
    .reduce((groups, location) => {
      const label = categoryLabels[location.category] || "Other";
      groups[label] = groups[label] || [];
      groups[label].push(location);
      return groups;
    }, {});

  const options = Object.entries(grouped)
    .map(([label, locations]) => `
      <optgroup label="${label}">
        ${locations.map(loc => `<option value="${loc.id}">${loc.name}</option>`).join("")}
      </optgroup>
    `)
    .join("");
  select.innerHTML = `<option value="">Select Landmark</option>` + options;
}

function openLegalModal(type) {
  const isPrivacy = type === "privacy";
  showConfirmDialog({
    title: isPrivacy ? "Privacy Policy" : "Terms of Service",
    message: isPrivacy
      ? "OpRides uses your account, ride, wallet, and location data only to operate campus transport features and support your account. Full hosted policy page will be added before public release."
      : "By using OpRides, you agree to use the service responsibly, keep account details accurate, and follow campus transport rules. Full hosted terms page will be added before public release.",
    confirmText: "Close",
    cancelText: "Dismiss"
  });
}

async function confirmDeleteAccount() {
  if (state.currentUser?.isGuest) {
    logout();
    return;
  }

  const confirmed = await showConfirmDialog({
    title: "Delete Account",
    message: "This signs out and permanently deletes your login account. You may need to sign in again first if this session is old.",
    confirmText: "Delete Account",
    cancelText: "Keep Account",
    danger: true
  });
  if (!confirmed) return;

  try {
    const activeUser = auth.currentUser;
    if (!activeUser) throw new Error("No active authenticated user");
    await deleteUser(activeUser);
    showToast("Account deleted", "success");
    showLoginScreen();
  } catch (err) {
    console.warn("Delete account failed:", err.code || err.message);
    if (err.code === "auth/requires-recent-login") {
      showToast("Please log in again before deleting your account", "error", 5000);
      await logout();
      return;
    }
    showToast("Could not delete account right now", "error");
  }
}

function openHelpModal() {
  const modal = document.getElementById("helpModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  // show the faq for whoever is logged in (student or rider)
  const isRider = state.currentRole === "rider";
  const studentFaq = document.getElementById("studentFaqAccordion");
  const riderFaq = document.getElementById("riderFaqAccordion");
  if (studentFaq) studentFaq.style.display = isRider ? "none" : "";
  if (riderFaq) riderFaq.style.display = isRider ? "" : "none";
}

function closeHelpModal() {
  const modal = document.getElementById("helpModal");
  if (modal) modal.classList.add("hidden");
}

async function handleSupportRequestSubmit(e) {
  e.preventDefault();
  
  const submitBtn = document.getElementById("submitIssueBtn");
  const form = document.getElementById("reportIssueForm");
  const categorySelect = document.getElementById("issueCategory");
  const subjectInput = document.getElementById("issueSubject");
  const descriptionInput = document.getElementById("issueDescription");
  
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;
  
  try {
    const user = state.currentUser || {};
    const supportRequest = {
      userId: user.uid || (user.isGuest ? "guest" : "unknown"),
      userName: user.displayName || user.name || (user.isGuest ? "Guest" : "Unknown"),
      userEmail: user.email || (user.isGuest ? "guest@example.com" : "unknown"),
      userRole: user.role || "student",
      category: categorySelect.value,
      subject: subjectInput.value.trim(),
      description: descriptionInput.value.trim(),
      createdAt: serverTimestamp(),
      status: "open"
    };
    
    await addDoc(collection(db, "support_requests"), supportRequest);
    showToast("Support report submitted successfully!", "success");
    
    form.reset();
    closeHelpModal();
  } catch (err) {
    console.error("Failed to submit support request:", err);
    showToast("Failed to submit report. Please try again.", "error");
  } finally {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }
}

function bindAppGlobals() {
  window.switchTab = switchTab;
  window.toggleSidebar = toggleSidebar;
  window.closeSidebar = closeSidebar;
  window.switchStudentView = switchStudentView;
  window.showMap = showMap;
  window.hideMap = hideMap;
  window.hideRiderMap = hideRiderMap;
  window.toggleAppTheme = toggleAppTheme;
  window.requestKeke = requestKeke;
  window.cancelRide = cancelRide;
  window.completeRide = completeRide;
  window.cleanupRiderSession = cleanupRiderSession;
  window.navigateToLandmark = navigateToLandmark;
  window.resetPathfinder = resetPathfinder;
  window.completePathfinderSession = completePathfinderSession;
  window.openLegalModal = openLegalModal;
  window.openHelpModal = openHelpModal;
  window.closeHelpModal = closeHelpModal;
  window.confirmDeleteAccount = confirmDeleteAccount;
  window.updateNavPill = updateNavPill;
  window.initNavPills = initNavPills;
  window.updateLiveNotifDot = updateLiveNotifDot;
  window.updateBalanceChipGlow = updateBalanceChipGlow;
  window.animateBalanceCounter = animateBalanceCounter;
}

bindAppGlobals();

window.visitRide = async (requestId) => {
  state.currentRequestId = requestId;
  const docRef = doc(db, "rideRequests", requestId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const r = docSnap.data();
    switchTab('live');
    const sheet = document.getElementById("studentSheet");
    if (sheet) {
      sheet.classList.remove("hidden", "expanded");
      sheet.classList.add("minimized");
    }
    import("./modules/student.js").then(m => m.listenToRequest(requestId));
    updateBottomSheet(r.status === "searching" ? "Searching" : "Trip Active", r.status);
    updateRideDetails("student", [
      { label: "Status", value: r.status },
      { label: "From", value: r.pickup.label },
      { label: "To", value: r.dropoff.label }
    ]);
  }
};

window.viewRideDetails = async (requestId) => {
  const content = document.getElementById("rideDetailContent");
  if (!content) return;
  content.innerHTML = '<p class="empty-state">Loading details...</p>';
  window.switchStudentView('detail');
  try {
    const docRef = doc(db, "rideRequests", requestId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const r = docSnap.data();
      content.innerHTML = `
        <div class="profile-card">
          <h3>Ride Info</h3>
          <div class="settings-list" style="text-align:left;">
            <div class="settings-item"><span>Status</span><strong>${r.status}</strong></div>
            <div class="settings-item"><span>From</span><strong>${r.pickup.label}</strong></div>
            <div class="settings-item"><span>To</span><strong>${r.dropoff.label}</strong></div>
            <div class="settings-item"><span>Requested</span><strong>${r.requestedAt ? new Date(r.requestedAt.seconds * 1000).toLocaleString() : 'N/A'}</strong></div>
          </div>
        </div>
      `;
    }
  } catch (err) {
    content.innerHTML = '<p class="empty-state">Failed to load details</p>';
  }
};

window.restoreActiveRideUI = async () => {
  if (!state.currentRideId) return;
  const docRef = doc(db, "rides", state.currentRideId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    switchTab("live");
    const riderSheet = document.getElementById("riderSheet");
    riderSheet?.classList.remove("hidden", "expanded");
    riderSheet?.classList.add("minimized");
    if (!state.map) initMap("riderMap");
    listenToActiveRide(state.currentRideId);
    window.updateRideUI(docSnap.data());
    showToast("Trip map restored");
  }
};

window.becomeAvailable = () => {
  if (state.riderWatchId) return;
  setButtonVisible("goLiveBtn", false);
  document.getElementById("riderTitle").innerText = "Online";
  document.getElementById("riderSub").innerText = "Activating GPS...";
  // document.getElementById("availableRidesSection").classList.remove("hidden"); // showing passengers now instead
  showToast("Activating GPS...", "info");
  initMap("riderMap");
  
  state.riderWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    
    if (accuracy > 100) {
      document.getElementById("riderSub").innerText = "Weak GPS (Searching...)";
      return;
    }
    
    document.getElementById("riderSub").innerText = "Keke Online & Ready";
    
    const distMoved = state.lastRiderLoc ? getDistance(state.lastRiderLoc.lat, state.lastRiderLoc.lng, latitude, longitude) : 999;
    if (distMoved < 3) return; 
    
    state.lastRiderLoc = { lat: latitude, lng: longitude };
    
    if (state.map && !state.currentRideId) {
      if (!state.riderMarker) {
        state.riderMarker = L.marker([latitude, longitude], { icon: riderKekeIcon }).addTo(state.map);
      } else {
        animateMarker(state.riderMarker, latitude, longitude, 800);
      }
      state.map.panTo([latitude, longitude], { animate: true });
    }
    
    if (!state.riderDocId) {
      state.riderDocId = "creating...";
      // double-check in case checkForActiveRide already found a ride before we even got here
      if (state.currentRideId && state.currentRideId !== "creating...") {
        state.riderDocId = state.currentRideId;
        return;
      }
      const ref = await addDoc(collection(db, "rides"), {
        riderId: state.currentUser.uid,
        riderName: state.currentUser.displayName,
        status: "waiting",
        seats: {
          total: 4,
          occupied: 0,
          available: 4
        },
        currentLocation: {
          lat: latitude,
          lng: longitude
        },
        stopQueue: [],
        passengers: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      state.riderDocId = ref.id;
      state.currentRideId = ref.id;
      updateLiveNotifDot("rider");
      listenToActiveRide(ref.id);
      listenForQueuedStudents(ref.id);
      await drainWaitingQueueForRide(ref.id);
    } else if (state.riderDocId !== "creating...") {
      await updateDoc(doc(db, "rides", state.riderDocId), { 
        currentLocation: { lat: latitude, lng: longitude },
        updatedAt: serverTimestamp()
      });
      await drainWaitingQueueForRide(state.riderDocId);
    }
  }, (err) => {
    showToast("Location access required", "error");
  }, { 
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
};

window.setArriving = async () => {
  // this is handled inside markStopComplete in rider.js now
};

window.startRide = async () => {
  // also handled in rider.js via markStopComplete
};

// ===== ORCHESTRATION =====

async function transitionToDashboard(user) {
  console.log("Transitioning to dashboard for user:", user);
  if (!user || !user.role) {
    console.warn("User role missing during transition, staying on login screen.");
    // Fallback: assume student for testing purposes if user exists but role is missing
    if (user) user.role = 'student';
    else return;
  }

  const loginScreen = document.getElementById("loginScreen");
  const studentUI = document.getElementById("studentUI");
  const riderUI = document.getElementById("riderUI");

  if (!loginScreen || !studentUI || !riderUI) {
    // just in case dom isn't ready yet
    document.getElementById("loginScreen")?.classList.add("hidden");
    if (user.role === "student") {
      document.getElementById("studentUI")?.classList.remove("hidden");
    } else {
      document.getElementById("riderUI")?.classList.remove("hidden");
    }
    return;
  }

  // ask for notification permission when they log in
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(err => console.warn("Notification permission request rejected:", err));
  }

  // fade out the login screen smoothly
  loginScreen.classList.add("screen-fade-out");

  setTimeout(async () => {
    loginScreen.classList.add("hidden");
    loginScreen.classList.remove("screen-fade-out");

    // hide both before deciding which to show
    studentUI.classList.add("hidden");
    riderUI.classList.add("hidden");

    if (user.role === "student") {
      console.log("Setting role to student and showing studentUI");
      state.currentRole = "student";
      
      studentUI.classList.remove("hidden");
      studentUI.classList.add("screen-fade-in");
      setTimeout(() => studentUI.classList.remove("screen-fade-in"), 600);

      startScheduledRidesProcessor();
      populateLocations();
      updateStudentProfileUI();
      listenToStudentWallet();
      startCampusActivityListeners();
      
      // force wallet tab visible just in case it got hidden somehow
      const walletTab = document.getElementById("tab-wallet");
      if (walletTab) walletTab.classList.remove("hidden");
      
      if (window.switchStudentView) window.switchStudentView('dashboard');
      await checkForActiveRide("student");
      // init pill and glow after the ui is visible
      setTimeout(() => { initNavPills(); updateBalanceChipGlow("student"); }, 100);
    } else if (user.role === "rider") {
      console.log("Setting role to rider and showing riderUI");
      state.currentRole = "rider";
      
      riderUI.classList.remove("hidden");
      riderUI.classList.add("screen-fade-in");
      setTimeout(() => riderUI.classList.remove("screen-fade-in"), 600);

      updateRiderDashboardUI();
      listenToRiderWallet();
      switchTab('home');
      await checkForActiveRide("rider");
      // same thing for rider side
      setTimeout(() => { initNavPills(); updateBalanceChipGlow("rider"); }, 100);
    } else {
      console.error("Unknown user role:", user.role);
      showLoginScreen();
    }
  }, 450); // match screen-fade-out duration (0.45s)
}

async function checkForActiveRide(role) {
  if (role === "student") {
    const q = query(
      collection(db, "rideRequests"), 
      where("studentId", "==", state.currentUser?.uid),
      where("status", "in", ["searching", "matched", "queued"])
    );
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      const activeRequest = querySnapshot.docs[0];
      state.currentRequestId = activeRequest.id;
      import("./modules/student.js").then(m => m.listenToRequest(activeRequest.id));
    }
  } else {
    const q = query(
      collection(db, "rides"), 
      where("riderId", "==", state.currentUser?.uid),
      where("status", "in", ["waiting", "active"])
    );
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      // sort and pick the latest one in case there are multiple
      const sortedDocs = querySnapshot.docs.sort((a, b) => 
        (b.data().updatedAt?.seconds || 0) - (a.data().updatedAt?.seconds || 0)
      );
      
      const activeRide = sortedDocs[0];
      state.riderDocId = activeRide.id;
      state.currentRideId = activeRide.id;
      updateLiveNotifDot("rider");
      const activeRideSection = document.getElementById("riderActiveRideSection");
      const activeRideSub = document.getElementById("riderActiveRideSub");
      activeRideSection?.classList.remove("hidden");
      if (activeRideSub) activeRideSub.innerText = `Keke Online - ${activeRide.data().seats.occupied} passengers`;
      import("./modules/rider.js").then(m => m.listenToActiveRide(activeRide.id));
      listenForQueuedStudents(activeRide.id);
      await drainWaitingQueueForRide(activeRide.id);

      // kill off any old stale rides from before — only one should be active
      for (let i = 1; i < sortedDocs.length; i++) {
        await updateDoc(doc(db, "rides", sortedDocs[i].id), { 
          status: "completed", 
          reason: "stale_cleanup" 
        });
      }
    }
  }
}

function startListeners() {
  // this function is empty now, we switched to per-ride listeners
}

function listenForQueuedStudents(rideId) {
  if (state.unsubscribeQueueListener) return;

  const q = query(
    collection(db, "waitingQueue"),
    orderBy("joinedAt")
  );

  state.unsubscribeQueueListener = onSnapshot(
    q,
    async () => {
      if (!state.riderDocId || state.riderDocId !== rideId) return;
      await drainWaitingQueueForRide(rideId);
    },
    (err) => {
      console.warn("Queue listener unavailable:", err.code || err.message);
      state.unsubscribeQueueListener = null;
    }
  );
}

// Minimum keke movement (metres) required before we bother recalculating the
// route and rebuilding stop markers. Keeps the map smooth between GPS ticks.
const RIDE_UI_MIN_MOVE_M = 5;

window.updateRideUI = (ride) => {
  state.latestRide = ride;
  renderLiveSheetEnhancements(ride);
  if (!state.map) return;
  
  const currentLocation = ride.currentLocation;

  // ── Keke marker ──────────────────────────────────────────────────────────
  if (currentLocation) {
    if (!state.riderMarker) {
      state.riderMarker = L.marker([currentLocation.lat, currentLocation.lng], { icon: riderKekeIcon }).addTo(state.map);
      state.riderMarker.bindTooltip('<span class="map-keke-label"><i class="fas fa-motorcycle keke-moving"></i> Keke</span>', {
        permanent: true,
        direction: "top",
        offset: [0, -18],
        className: "map-keke-tooltip"
      });
    } else {
      animateMarker(state.riderMarker, currentLocation.lat, currentLocation.lng, 1000);
    }
  }

  // ── Throttle: skip route + stop-marker work if keke hasn't moved enough ──
  const pendingStops = ride.stopQueue.filter(s => s.status === "pending");

  if (currentLocation && state.lastRenderedLocation) {
    const moved = getDistance(
      state.lastRenderedLocation.lat, state.lastRenderedLocation.lng,
      currentLocation.lat, currentLocation.lng
    );
    // Also skip when the pending stop list hasn't changed shape
    const stopKey = pendingStops.map(s => `${s.passengerId}:${s.type}`).join("|");
    if (moved < RIDE_UI_MIN_MOVE_M && stopKey === state.lastRenderedLocation.stopKey) {
      return;
    }
  }

  // Record what we're about to render so the next call can diff against it
  if (currentLocation) {
    state.lastRenderedLocation = {
      lat: currentLocation.lat,
      lng: currentLocation.lng,
      stopKey: pendingStops.map(s => `${s.passengerId}:${s.type}`).join("|")
    };
  }

  // ── Route line ────────────────────────────────────────────────────────────
  if (pendingStops.length > 0 && currentLocation) {
    const nextStop = pendingStops[0];
    const route = calculateCampusRoute(
      [currentLocation.lat, currentLocation.lng],
      [nextStop.location.lat, nextStop.location.lng]
    );
    drawCampusRoute(route.points, {
      color: "#22c55e",
      weight: 6,
      dashArray: route.routed ? null : "8, 10"
    });

    // ── Stop markers (cached) ────────────────────────────────────────────────
    // Build the set of keys we need this frame
    const neededKeys = new Set(
      pendingStops.map(s => `${s.passengerId}:${s.type}:${s.location.lat}:${s.location.lng}`)
    );

    // Remove any cached markers that are no longer in pendingStops
    for (const [key, marker] of state.stopMarkersCache) {
      if (!neededKeys.has(key)) {
        if (state.map && state.map.hasLayer(marker)) state.map.removeLayer(marker);
        state.stopMarkersCache.delete(key);
      }
    }

    // Add markers that aren't cached yet
    pendingStops.forEach(stop => {
      const key = `${stop.passengerId}:${stop.type}:${stop.location.lat}:${stop.location.lng}`;
      if (!state.stopMarkersCache.has(key)) {
        if (!state.map) return;
        const marker = L.marker([stop.location.lat, stop.location.lng], {
          icon: stop.type === "pickup" ? pickupPinIcon : dropoffPinIcon
        }).addTo(state.map);
        marker.bindPopup(`${stop.type === "pickup" ? "Pick up" : "Drop off"}: ${stop.passengerName}<br>${stop.locationLabel}`);
        state.stopMarkersCache.set(key, marker);
      }
    });

    // Keep legacy requestMarkers array in sync (used elsewhere for cleanup)
    state.requestMarkers = [...state.stopMarkersCache.values()];
  } else {
    clearRouteLayer();

    // Remove all cached stop markers when there are no pending stops
    if (state.map) {
      for (const marker of state.stopMarkersCache.values()) {
        if (state.map.hasLayer(marker)) state.map.removeLayer(marker);
      }
    }
    state.stopMarkersCache.clear();
    state.requestMarkers = [];
  }
};

// ===== INIT =====
window.addEventListener("load", () => {
  const helpModalElement = document.getElementById("helpModal");
  if (helpModalElement) {
    helpModalElement.addEventListener("click", (e) => {
      if (e.target.id === "helpModal") closeHelpModal();
    });
  }

  const reportFormElement = document.getElementById("reportIssueForm");
  if (reportFormElement) {
    reportFormElement.addEventListener("submit", handleSupportRequestSubmit);
  }

  initAuth({
    onUserChanged: async (user) => {
      if (user) {
        state.currentUser = user;
        await loadCampusDataFromFirestore();
        transitionToDashboard(user);
      } else {
        const previousUser = state.currentUser;
        await cleanupRiderSession(previousUser);
        state.currentUser = null;

        // wipe everything when they log out
        if (state.unsubscribeRequests) state.unsubscribeRequests();
        if (state.unsubscribeQueueListener) state.unsubscribeQueueListener();
        stopCampusActivityListeners();
        if (state.map) state.map.remove();
        if (state.riderWatchId) navigator.geolocation.clearWatch(state.riderWatchId);
        stopPathfinderWatch();
        
        state.unsubscribeRequests = null;
        state.unsubscribeQueueListener = null;
        state.map = null;
        state.riderWatchId = null;
        state.riderDocId = null;
        state.currentRideId = null;
        state.currentRequestId = null;
        state.lastRiderLoc = null;
        state.riderMarker = null;
        state.userMarker = null;
        state.routeLayer = null;
        state.stopMarkersCache.clear();
        state.lastRenderedLocation = null;
        
        showLoginScreen();
      }
    },
    showLoginScreen
  });
});
