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
  addDoc,
  serverTimestamp
} from "./firebase.js";
import { initAuth } from "./auth.js";
import "./seeding.js";
import { state } from "./modules/state.js";
window.state = state;
import { CAMPUS_MAP_DATA } from "./campus-data.js";
import { 
  showToast, 
  updateBottomSheet, 
  updateRideDetails, 
  toggleControls, 
  setButtonVisible,
  showLoginScreen 
} from "./modules/ui.js";
import { 
  initMap, 
  animateMarker, 
  getDistance,
  stabilizeLocation
} from "./modules/map-manager.js";
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
import { listenToStudentWallet, renderStudentWallet } from "./wallet.js";
import { listenToRiderWallet, renderRiderWallet } from "./riderWallet.js";

// ================= GLOBAL BINDINGS =================
function toggleSidebar() {
  const sidebar = document.getElementById("studentSidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar || !overlay) return;
  const isHidden = sidebar.classList.contains("hidden");
  sidebar.classList.toggle("hidden", !isHidden);
  overlay.classList.toggle("hidden", !isHidden);
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

  // Hide all views for both roles to be safe
  [...Object.values(studentViews), ...Object.values(riderViews)].forEach(vId => {
    const el = document.getElementById(vId);
    if (el) el.classList.add("hidden");
  });

  // Handle specific tab logic
  if (role === "student") {
    if (tab === "activity") {
      if (state.currentUser?.isGuest) return showToast("Signup to view activity", "error");
      fetchRideHistory();
    } else if (tab === "wallet") {
      renderStudentWallet();
    } else if (tab === "map") {
      populateCampusMapLandmarks();
    } else if (tab === "live") {
      setTimeout(() => initMap("studentMap"), 100);
    }
  } else if (role === "rider") {
    if (tab === "profile") {
      updateRiderProfileUI();
    } else if (tab === "earnings" || tab === "withdraw") {
      renderRiderWallet();
    } else if (tab === "live") {
      setTimeout(() => {
        initMap("riderMap");
        if (state.currentRideId) {
          document.getElementById("riderSheet")?.classList.remove("hidden");
        }
      }, 100);
    }
  }

  // Show selected view
  const targetView = views[tab];
  if (targetView) {
    document.getElementById(targetView).classList.remove("hidden");
  }

  // Update bottom nav active state
  const navSelector = role === "student" ? "#studentUI .nav-tab" : "#riderUI .nav-tab";
  document.querySelectorAll(navSelector).forEach(t => {
    const tId = t.id.replace("tab-", "").replace("rider-", "");
    t.classList.toggle("active", tId === tab);
  });
}

function updateRiderProfileUI() {
  if (!state.currentUser) return;
  const user = state.currentUser;
  const nameEl = document.getElementById("riderProfileName");
  const emailEl = document.getElementById("riderProfileEmail");
  const plateEl = document.getElementById("riderProfilePlate");
  
  if (nameEl) nameEl.innerText = user.displayName || "Rider";
  if (emailEl) emailEl.innerText = user.email || "No email";
  if (plateEl) plateEl.innerText = user.plateNo || "No Plate";

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
  document.getElementById("riderDashboard").classList.remove("hidden");
  document.getElementById("riderMap").classList.add("hidden");
  document.getElementById("riderMapBackBtn").classList.add("hidden");
  document.getElementById("riderSheet").classList.add("hidden");
}

async function requestKeke() {
  await _requestKeke();
  startListeners();
}

async function cancelRide() {
  await _cancelRide();
  state.currentRideId = null;
}

async function completeRide() {
  await _completeRide();
  state.currentRideId = null;
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

async function navigateToLandmark(landmarkId) {
  if (!landmarkId) return;
  const landmark = CAMPUS_MAP_DATA.locations.find(l => l.id === landmarkId);
  if (!landmark) return;

  document.getElementById("studentDashboard").classList.add("hidden");
  document.getElementById("pathfinderView").classList.add("hidden");
  document.getElementById("studentMap").classList.remove("hidden");
  document.getElementById("mapBackBtn").classList.remove("hidden");
  
  initMap("studentMap");
  
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    if (!state.userMarker) {
      state.userMarker = L.marker([latitude, longitude]).addTo(state.map).bindPopup("Your Location");
    } else {
      state.userMarker.setLatLng([latitude, longitude]);
    }
    
    if (state.routeControl) {
      state.routeControl.setWaypoints([
        L.latLng(latitude, longitude),
        L.latLng(landmark.lat, landmark.lng)
      ]);
    } else {
      state.routeControl = L.Routing.control({
        waypoints: [
          L.latLng(latitude, longitude),
          L.latLng(landmark.lat, landmark.lng)
        ],
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        lineOptions: { styles: [{ color: '#3b82f6', weight: 6 }] }
      }).addTo(state.map);
    }
    state.map.fitBounds(L.latLngBounds([latitude, longitude], [landmark.lat, landmark.lng]), { padding: [50, 50] });
    showToast(`Pathfinding to ${landmark.name}`);
  }, (err) => {
    showToast("GPS required for navigation", "error");
  });
}

function populateCampusMapLandmarks() {
  const select = document.getElementById("pathfinderSelect");
  if (!select) return;
  if (select.children.length > 1) return; // Already populated
  
  const options = CAMPUS_MAP_DATA.locations
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(loc => `<option value="${loc.id}">${loc.name}</option>`)
    .join("");
  select.innerHTML = `<option value="">Select Landmark</option>` + options;
}

function bindAppGlobals() {
  window.switchTab = switchTab;
  window.toggleSidebar = toggleSidebar;
  window.switchStudentView = switchStudentView;
  window.showMap = showMap;
  window.hideMap = hideMap;
  window.hideRiderMap = hideRiderMap;
  window.requestKeke = requestKeke;
  window.cancelRide = cancelRide;
  window.completeRide = completeRide;
  window.cleanupRiderSession = cleanupRiderSession;
  window.navigateToLandmark = navigateToLandmark;
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
      sheet.classList.remove("hidden", "minimized");
      sheet.classList.add("expanded");
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
    document.getElementById("riderDashboard").classList.add("hidden");
    document.getElementById("riderMap").classList.remove("hidden");
    document.getElementById("riderSheet").classList.remove("hidden");
    document.getElementById("riderMapBackBtn").classList.remove("hidden");
    initMap("riderMap");
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
  // document.getElementById("availableRidesSection").classList.remove("hidden"); // We'll show current passengers instead
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
        state.riderMarker = L.circleMarker([latitude, longitude], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(state.map);
      } else {
        animateMarker(state.riderMarker, latitude, longitude, 800);
      }
      state.map.panTo([latitude, longitude], { animate: true });
    }
    
    if (!state.riderDocId) {
      state.riderDocId = "creating...";
      // Check one more time if a ride was found by checkForActiveRide during this same session
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
  // Logic handled via markStopComplete in rider.js
};

window.startRide = async () => {
  // Logic handled via markStopComplete in rider.js
};

// ================= ORCHESTRATION =================

async function transitionToDashboard(user) {
  if (!user || !user.role) {
    console.warn("User role missing during transition, staying on login screen.");
    return;
  }

  document.getElementById("loginScreen").classList.add("hidden");
  
  // Hide all role UIs first to ensure a clean state
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");

  if (user.role === "student") {
    state.currentRole = "student";
    document.getElementById("studentUI").classList.remove("hidden");
    startScheduledRidesProcessor();
    populateLocations();
    updateStudentProfileUI();
    listenToStudentWallet();
    if (window.switchStudentView) window.switchStudentView('dashboard');
    await checkForActiveRide("student");
  } else if (user.role === "rider") {
    state.currentRole = "rider";
    document.getElementById("riderUI").classList.remove("hidden");
    updateRiderDashboardUI();
    listenToRiderWallet();
    switchTab('home');
    await checkForActiveRide("rider");
  } else {
    console.error("Unknown user role:", user.role);
    showLoginScreen();
  }
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
      // Use the most recent active ride
      const sortedDocs = querySnapshot.docs.sort((a, b) => 
        (b.data().updatedAt?.seconds || 0) - (a.data().updatedAt?.seconds || 0)
      );
      
      const activeRide = sortedDocs[0];
      state.riderDocId = activeRide.id;
      state.currentRideId = activeRide.id;
      document.getElementById("riderActiveRideSection").classList.remove("hidden");
      document.getElementById("riderActiveRideSub").innerText = `Keke Online - ${activeRide.data().seats.occupied} passengers`;
      import("./modules/rider.js").then(m => m.listenToActiveRide(activeRide.id));
      listenForQueuedStudents(activeRide.id);
      await drainWaitingQueueForRide(activeRide.id);

      // Clean up any other "stale" active sessions for this rider
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
  // Old startListeners removed as we use per-ride/per-request listeners now
}

function listenForQueuedStudents(rideId) {
  if (state.unsubscribeQueueListener) return;

  const q = query(
    collection(db, "waitingQueue"),
    orderBy("joinedAt")
  );

  state.unsubscribeQueueListener = onSnapshot(q, async () => {
    if (!state.riderDocId || state.riderDocId !== rideId) return;
    await drainWaitingQueueForRide(rideId);
  });
}

window.updateRideUI = (ride) => {
  if (!state.map) return;
  
  const currentLocation = ride.currentLocation;
  if (currentLocation) {
    if (!state.riderMarker) {
      state.riderMarker = L.circleMarker([currentLocation.lat, currentLocation.lng], { radius: 8, color: '#22c55e', fillOpacity: 1 }).addTo(state.map);
    } else {
      animateMarker(state.riderMarker, currentLocation.lat, currentLocation.lng, 1000);
    }
  }

  // Draw route to next stop
  const pendingStops = ride.stopQueue.filter(s => s.status === "pending");
  if (pendingStops.length > 0 && currentLocation) {
    const nextStop = pendingStops[0];
    if (!state.routeControl) {
      state.routeControl = L.Routing.control({
        waypoints: [L.latLng(currentLocation.lat, currentLocation.lng), L.latLng(nextStop.location.lat, nextStop.location.lng)],
        createMarker: () => null,
        addWaypoints: false,
        draggableWaypoints: false,
        show: false,
        lineOptions: { styles: [{ color: '#22c55e', weight: 6 }] }
      }).addTo(state.map);
    } else {
      state.routeControl.setWaypoints([L.latLng(currentLocation.lat, currentLocation.lng), L.latLng(nextStop.location.lat, nextStop.location.lng)]);
    }

    // Add markers for stops
    if (state.map) {
      state.requestMarkers.forEach(m => {
        if (m && state.map.hasLayer(m)) state.map.removeLayer(m);
      });
    }
    state.requestMarkers = [];
    pendingStops.forEach(stop => {
       if (!state.map) return;
       const marker = L.circleMarker([stop.location.lat, stop.location.lng], { 
         radius: 6, 
         color: stop.type === 'pickup' ? '#3b82f6' : '#ef4444', 
         fillOpacity: 1 
       }).addTo(state.map);
       marker.bindPopup(`${stop.type === 'pickup' ? 'Pick up' : 'Drop off'}: ${stop.passengerName}<br>${stop.locationLabel}`);
       state.requestMarkers.push(marker);
    });
  }
};

// ================= INIT =================
window.addEventListener("load", () => {
  initAuth({
    onUserChanged: async (user) => {
      if (user) {
        state.currentUser = user;
        transitionToDashboard(user);
      } else {
        const previousUser = state.currentUser;
        await cleanupRiderSession(previousUser);
        state.currentUser = null;

        // Clear all state on logout
        if (state.unsubscribeRequests) state.unsubscribeRequests();
        if (state.unsubscribeQueueListener) state.unsubscribeQueueListener();
        if (state.map) state.map.remove();
        if (state.riderWatchId) navigator.geolocation.clearWatch(state.riderWatchId);
        
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
        state.routeControl = null;
        
        showLoginScreen();
      }
    },
    showLoginScreen
  });
});
