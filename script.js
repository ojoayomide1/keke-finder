import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ================= FIREBASE =================
const firebaseConfig = {
  apiKey: "AIza...", 
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.appspot.com",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ================= GLOBAL =================
let map = null;
let listenersStarted = false;

let currentRole = null;
let currentRideId = null;
let riderDocId = null;

let requestMarkers = [];
let riderMarker = null;
let routeControl = null;
let userMarker = null;

// ================= MAP =================
function initMap(mapId) {
  if (map) map.remove();

  map = L.map(mapId, { tap: false })
    .setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 400);

  if (!listenersStarted) {
    startListeners();
    listenersStarted = true;
  }
}

// ================= ROLE =================
window.selectRole = (role) => {
  currentRole = role;
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 150);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 150);
  }
};

window.goBack = () => {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");
  if (map) map.remove();
};

// ================= BOTTOM SHEET =================
function getActiveSheet() {
  return currentRole === "student" ? 
    document.getElementById("studentSheet") : document.getElementById("riderSheet");
}

function updateBottomSheet(title, sub) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  sheet.querySelector("h3").innerText = title;
  sheet.querySelector("p").innerText = sub;
}

function toggleControls(show) {
  const sheet = getActiveSheet();
  if (!sheet) return;
  const controls = sheet.querySelector(".controls");
  if (controls) controls.style.display = show ? "flex" : "none";
}

// ================= STUDENT =================
window.requestKeke = async () => {
  updateBottomSheet("📍 Getting location...", "Please wait");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    const ref = await addDoc(collection(db, "requests"), {
      lat: latitude,
      lng: longitude,
      status: "waiting",
      time: Date.now()
    });

    currentRideId = ref.id;

    map.setView([latitude, longitude], 16);

    userMarker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup("📍 You");

    updateBottomSheet("🔍 Searching...", "Connecting to riders...");
  });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const name = prompt("Enter your name:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Waiting for rides...");

  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    if (!riderDocId) {
      const ref = await addDoc(collection(db, "kekes"), {
        name,
        lat: latitude,
        lng: longitude
      });
      riderDocId = ref.id;
    } else {
      await updateDoc(doc(db, "kekes", riderDocId), {
        lat: latitude,
        lng: longitude
      });
    }
  });
};

// ================= STATUS =================
window.setArriving = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "arriving" });
};

window.completeRide = async () => {
  if (!currentRideId) return;
  await updateDoc(doc(db, "requests", currentRideId), { status: "completed" });
};

// ================= MAIN LISTENER (Your original logic restored) =================
function startListeners() {
  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    if (!map) return;

    // Clear old markers
    requestMarkers.forEach(m => map.removeLayer(m));
    requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      const rideId = docSnap.id;

      // Show request markers
      const marker = L.circleMarker([r.lat, r.lng], {color: 'red'}).addTo(map);
      requestMarkers.push(marker);

      marker.on("click", async () => {
        if (r.status !== "waiting" || currentRole !== "rider") return;

        if (confirm("Accept this ride?")) {
          navigator.geolocation.getCurrentPosition(async (pos) => {
            await updateDoc(doc(db, "requests", rideId), {
              status: "accepted",
              riderLat: pos.coords.latitude,
              riderLng: pos.coords.longitude
            });
            currentRideId = rideId;
          });
        }
      });

      // Track only current active ride
      if (rideId !== currentRideId) return;

      if (r.riderLat && r.riderLng) {
        // 🔥 ROAD ROUTE - Only show routing panel for Rider
      if (routeControl) {
        map.removeControl(routeControl);
      }

      routeControl = L.Routing.control({
        waypoints: [
          L.latLng(r.riderLat, r.riderLng),
          L.latLng(r.lat, r.lng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        createMarker: () => null,
        lineOptions: {
          styles: [{ color: '#22c55e', weight: 6 }]
        },
        // Hide the complicated turn-by-turn instructions
        show: currentRole === "rider",           // Only show panel for rider
        addWaypoints: false,
        routeWhileDragging: false,
        collapsible: true
      }).addTo(map);

      // Rider marker
      if (!riderMarker) {
        riderMarker = L.marker([r.riderLat, r.riderLng])
          .addTo(map)
          .bindPopup("🚖 Rider");
      } else {
        riderMarker.setLatLng([r.riderLat, r.riderLng]);
      }

      const dist = map.distance([r.riderLat, r.riderLng], [r.lat, r.lng]);

      updateBottomSheet(
        currentRole === "student" ? "🚗 Rider coming" : "🚗 Heading to student", 
        `${Math.round(dist)}m away`
      );

      toggleControls(true);

      // Auto zoom and focus
      const bounds = L.latLngBounds([
        [r.riderLat, r.riderLng],
        [r.lat, r.lng]
      ]);
      map.fitBounds(bounds, { padding: [90, 90] });
      }
    });
  });
}

// ================= DRAG =================
function initBottomSheetDrag() {
  document.querySelectorAll(".bottomSheet").forEach(sheet => {
    const dragZone = sheet.querySelector(".dragZone");

    let startY = 0, offset = 0, dragging = false;

    const start = (y) => { dragging = true; startY = y - offset; };
    const move = (y) => {
      if (!dragging) return;
      offset = y - startY;
      if (offset < -300) offset = -300;
      if (offset > 0) offset = 0;
      sheet.style.transform = `translateY(${offset}px)`;
    };
    const end = () => {
      dragging = false;
      offset = offset < -150 ? -300 : 0;
      sheet.style.transform = `translateY(${offset}px)`;
    };

    dragZone.addEventListener("touchstart", e => start(e.touches[0].clientY));
    dragZone.addEventListener("touchmove", e => move(e.touches[0].clientY));
    dragZone.addEventListener("touchend", end);
  });
}

window.addEventListener("load", initBottomSheetDrag);
