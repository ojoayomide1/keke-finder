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
  if (map) {
    map.remove();
  }

  map = L.map(mapId, { tap: false })
    .setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 500);
}
// Remove the listenersStarted logic for now to avoid bugs when switching

// ================= ROLE =================
window.selectRole = (role) => {
  currentRole = role;

  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 200);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 200);
  }
};

window.goBack = () => {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");

  if (map) map.remove();
};

// ================= UI HELPERS =================
function getActiveSheet() {
  return currentRole === "student" ? 
         document.getElementById("studentSheet") : 
         document.getElementById("riderSheet");
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
  if (controls) {
    controls.style.display = show ? "flex" : "none";
  }
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

    updateBottomSheet("🔍 Searching...", "Connecting...");
  });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const name = prompt("Enter your rider name:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Looking for nearby requests...");

  navigator.geolocation.watchPosition((pos) => {
    const { latitude, longitude } = pos.coords;

    // Center rider on their location
    if (map && currentRole === "rider") {
      map.setView([latitude, longitude], 14);
    }

    // TODO: Later we can filter nearby requests
  }, null, { enableHighAccuracy: true });

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

// ================= UI LOGIC =================
function updateUI(r, dist) {
  if (currentRole === "student") {
    if (r.status === "waiting") {
      updateBottomSheet("🔍 Searching...", "Connecting...");
      toggleControls(false);
    } else if (r.status === "accepted") {
      updateBottomSheet("🚗 Rider coming", `${Math.round(dist)}m away`);
      toggleControls(true);
    } else if (r.status === "arriving") {
      updateBottomSheet("📍 Arriving", "Get ready");
    } else if (r.status === "completed") {
      updateBottomSheet("✅ Completed", "Thanks!");
      toggleControls(false);
    }
  } else if (currentRole === "rider") {
    if (r.status === "waiting") {
      updateBottomSheet("📥 New request", "Tap to accept");
    } else if (r.status === "accepted") {
      updateBottomSheet("🚗 Heading", `${Math.round(dist)}m away`);
      toggleControls(true);
    } else if (r.status === "arriving") {
      updateBottomSheet("📍 Arrived", "Waiting...");
    } else if (r.status === "completed") {
      updateBottomSheet("✅ Done", "Good job");
      toggleControls(false);
    }
  }
}

// ================= LISTENER (Your original core) =================
function startListeners() {
  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    if (!map) return;

    requestMarkers.forEach(m => map.removeLayer(m));
    requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();

      const marker = L.circleMarker([r.lat, r.lng]).addTo(map);

      marker.on("click", async () => {
        if (r.status !== "waiting") return;

        const ok = confirm("Accept ride?");
        if (!ok) return;

        navigator.geolocation.getCurrentPosition(async (pos) => {
          await updateDoc(doc(db, "requests", docSnap.id), {
            status: "accepted",
            riderLat: pos.coords.latitude,
            riderLng: pos.coords.longitude
          });

          currentRideId = docSnap.id;
        });
      });

      requestMarkers.push(marker);

      if (docSnap.id !== currentRideId) return;

      if (r.riderLat && r.riderLng) {

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
          createMarker: () => null
        }).addTo(map);

        if (!riderMarker) {
          riderMarker = L.marker([r.riderLat, r.riderLng])
            .addTo(map)
            .bindPopup("🚖 Rider");
        } else {
          riderMarker.setLatLng([r.riderLat, r.riderLng]);
        }

        const dist = map.distance([r.riderLat, r.riderLng], [r.lat, r.lng]);

        updateUI(r, dist);

        const bounds = L.latLngBounds([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ]);

        map.fitBounds(bounds, { padding: [80, 80] });
      }
    });
  });
}

// ================= DRAG =================
function initBottomSheetDrag() {
  document.querySelectorAll(".bottomSheet").forEach(sheet => {
    const dragZone = sheet.querySelector(".dragZone");

    let startY = 0;
    let offset = 0;
    let dragging = false;

    const start = (y) => {
      dragging = true;
      startY = y - offset;
    };

    const move = (y) => {
      if (!dragging) return;

      offset = y - startY;
      if (offset < -300) offset = -300;
      if (offset > 0) offset = 0;

      sheet.style.transform = `translateY(${offset}px)`;
    };

    const end = () => {
      dragging = false;

      if (offset < -150) offset = -300;
      else offset = 0;

      sheet.style.transform = `translateY(${offset}px)`;
    };

    dragZone.addEventListener("touchstart", e => start(e.touches[0].clientY));
    dragZone.addEventListener("touchmove", e => move(e.touches[0].clientY));
    dragZone.addEventListener("touchend", end);
  });
}

window.addEventListener("load", initBottomSheetDrag);
