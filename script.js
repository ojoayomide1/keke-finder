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

window.currentRole = null;
window.currentRideId = null;
window.riderDocId = null;

window.requestMarkers = [];
window.riderMarker = null;
window.rideLine = null;
window.userMarker = null;

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

  setTimeout(() => map.invalidateSize(), 300);

  if (!listenersStarted) {
    startListeners();
    listenersStarted = true;
  }
}

window.initMap = initMap;

// ================= ROLE =================
window.selectRole = (role) => {
  window.currentRole = role;

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

// ================= UI =================
function getActiveSheet() {
  return document.querySelector(`#${window.currentRole}UI .bottomSheet`);
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
    controls.classList.toggle("hidden", !show);
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

    window.currentRideId = ref.id;

    map.setView([latitude, longitude], 16);

    window.userMarker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup("📍 You");

    updateUI({ status: "waiting" }, 0);
  });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const name = prompt("Enter your name:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Waiting for rides...");

  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    if (!window.riderDocId) {
      const ref = await addDoc(collection(db, "kekes"), {
        name,
        lat: latitude,
        lng: longitude
      });
      window.riderDocId = ref.id;
    } else {
      await updateDoc(doc(db, "kekes", window.riderDocId), {
        lat: latitude,
        lng: longitude
      });
    }

    if (window.currentRideId) {
      await updateDoc(doc(db, "requests", window.currentRideId), {
        riderLat: latitude,
        riderLng: longitude
      });
    }
  });
};

// ================= STATUS =================
window.setArriving = async () => {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "arriving"
  });
};

window.completeRide = async () => {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "completed"
  });
};

// ================= UI LOGIC =================
function updateUI(r, dist) {
  if (window.currentRole === "student") {
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
  }

  if (window.currentRole === "rider") {
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

// ================= LISTENER =================
function startListeners() {
  const q = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(q, (snapshot) => {
    if (!map) return;

    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

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

          window.currentRideId = docSnap.id;
        });
      });

      window.requestMarkers.push(marker);

      // ✅ ONLY TRACK CURRENT RIDE
      if (docSnap.id !== window.currentRideId) return;

      if (r.riderLat && r.riderLng) {

        // 🔥 REMOVE OLD ROUTE
        if (window.routeControl) {
          map.removeControl(window.routeControl);
        }

        // 🔥 ROAD ROUTE
        window.routeControl = L.Routing.control({
          waypoints: [
            L.latLng(r.riderLat, r.riderLng),
            L.latLng(r.lat, r.lng)
          ],
          routeWhileDragging: false,
          addWaypoints: false,
          draggableWaypoints: false,
          createMarker: () => null
        }).addTo(map);

        // 🔥 RIDER MARKER
        if (!window.riderMarker) {
          window.riderMarker = L.marker([r.riderLat, r.riderLng])
            .addTo(map)
            .bindPopup("🚖 Rider");
        } else {
          window.riderMarker.setLatLng([r.riderLat, r.riderLng]);
        }

        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        updateUI(r, dist);

        // 🔥 AUTO ZOOM
        const bounds = L.latLngBounds([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ]);

        map.fitBounds(bounds, { padding: [80, 80] });
      }

    }); // ✅ CLOSE forEach

  }); // ✅ CLOSE onSnapshot

} // ✅ CLOSE function

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

    dragZone.addEventListener("mousedown", e => start(e.clientY));
    window.addEventListener("mousemove", e => move(e.clientY));
    window.addEventListener("mouseup", end);
  });
}

window.addEventListener("load", initBottomSheetDrag);
