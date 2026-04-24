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

// 🔥 Firebase config (KEEP FULL KEY)
const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ================= GLOBAL STATE =================
let map = null;
let listenersStarted = false;

window.requestMarkers = [];
window.riderMarker = null;
window.rideLine = null;
window.userMarker = null;
window.riderDocId = null;
window.currentRideId = null;

// ================= MAP =================
window.initMap = function (mapId) {
  if (map) {
    map.remove();
    map = null;
  }

  map = L.map(mapId).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 300);

  if (!listenersStarted) {
    startListeners();
    listenersStarted = true;
  }
};

// ================= UI =================
window.selectRole = function (role) {
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 150);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 150);
  }
};

window.goBack = function () {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");

  if (map) {
    map.remove();
    map = null;
  }
};

// ================= RIDER =================
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    try {
      // Save rider
      if (!window.riderDocId) {
        const ref = await addDoc(collection(db, "kekes"), {
          name,
          lat,
          lng,
          time: Date.now()
        });
        window.riderDocId = ref.id;
      } else {
        await updateDoc(doc(db, "kekes", window.riderDocId), {
          lat,
          lng,
          time: Date.now()
        });
      }

      // Update ride location
      if (window.currentRideId) {
        await updateDoc(doc(db, "requests", window.currentRideId), {
          riderLat: lat,
          riderLng: lng
        });
      }

      if (map) map.setView([lat, lng], 16);

    } catch (e) {
      console.error(e);
    }

  }, () => {
    alert("Enable location");
  }, { enableHighAccuracy: true });
};

// ================= STUDENT =================
window.requestKeke = function () {
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    try {
      const ref = await addDoc(collection(db, "requests"), {
        lat: latitude,
        lng: longitude,
        status: "waiting",
        time: Date.now()
      });

      window.currentRideId = ref.id;

      map.setView([latitude, longitude], 16);

      if (window.userMarker) map.removeLayer(window.userMarker);

      window.userMarker = L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup("📍 You")
        .openPopup();

      updateUI({ status: "waiting" }, 0);

    } catch (e) {
      console.error(e);
    }
  });
};

// ================= STATUS =================
window.setArriving = async function () {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "arriving"
  });
};

window.completeRide = async function () {
  if (!window.currentRideId) return;

  await updateDoc(doc(db, "requests", window.currentRideId), {
    status: "completed"
  });
};

// ================= UI UPDATE =================
function updateUI(r, dist) {
  const title = document.getElementById("rideTitle");
  const sub = document.getElementById("rideSub");
  const controls = document.getElementById("rideControls");

  if (!title || !sub || !controls) return;

  if (r.status === "waiting") {
    title.innerText = "🔍 Searching for rider";
    sub.innerText = "Connecting you...";
    controls.classList.add("hidden");
  }

  if (r.status === "accepted") {
    title.innerText = "🚗 Rider on the way";
    sub.innerText = `${Math.round(dist)}m away`;
    controls.classList.remove("hidden");
  }

  if (r.status === "arriving") {
    title.innerText = "📍 Rider is here";
    sub.innerText = "Step outside";
    controls.classList.remove("hidden");
  }

  if (r.status === "completed") {
    title.innerText = "✅ Trip completed";
    sub.innerText = "Thanks for riding!";
    controls.classList.add("hidden");
  }
}

const fab = document.querySelector(".fab");

if (fab) {
  if (r.status === "waiting" || r.status === "accepted") {
    fab.style.display = "none";
  } else {
    fab.style.display = "block";
  }
}

// ================= LISTENERS =================
function startListeners() {

  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(requestQuery, (snapshot) => {
    if (!map) return;

    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat || !r.lng) return;

      // student marker
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        fillColor: "red",
        color: "darkred",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map);

      // accept ride
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

      // tracking
      if (r.status === "accepted" && r.riderLat && r.riderLng) {

        // line
        if (window.rideLine) map.removeLayer(window.rideLine);

        window.rideLine = L.polyline([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ], { color: "green", weight: 5 }).addTo(map);

        // smooth rider movement
        if (window.riderMarker) {
          window.riderMarker.setLatLng([r.riderLat, r.riderLng]);
        } else {
          window.riderMarker = L.marker([r.riderLat, r.riderLng])
            .addTo(map)
            .bindPopup("🚖 Rider");
        }

        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        updateUI(r, dist);

        const bounds = L.latLngBounds([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ]);

        map.fitBounds(bounds, { padding: [50, 50] });
      }
    });
  });
}

// ================= ULTRA FIXED DRAG (MOBILE + DESKTOP) =================
function initBottomSheetDrag() {
  const sheets = document.querySelectorAll(".bottomSheet");

  sheets.forEach((sheet) => {

    let startY = 0;
    let currentY = 0;
    let offsetY = 0;
    let isDragging = false;

    const start = (clientY) => {
      isDragging = true;
      startY = clientY - offsetY;
    };

    const move = (clientY) => {
      if (!isDragging) return;

      currentY = clientY;
      offsetY = currentY - startY;

      // limits
      if (offsetY < -250) offsetY = -250;
      if (offsetY > 150) offsetY = 150;

      sheet.style.transform = `translateY(${offsetY}px)`;
    };

    const end = () => {
      isDragging = false;

      // snap positions
      if (offsetY < -120) {
        offsetY = -250; // open
      } else {
        offsetY = 0; // closed
      }

      sheet.style.transform = `translateY(${offsetY}px)`;
    };

    // TOUCH EVENTS
    sheet.addEventListener("touchstart", (e) => start(e.touches[0].clientY));
    sheet.addEventListener("touchmove", (e) => move(e.touches[0].clientY));
    sheet.addEventListener("touchend", end);

    // MOUSE EVENTS (for laptop testing)
    sheet.addEventListener("mousedown", (e) => start(e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientY));
    window.addEventListener("mouseup", end);

  });
}

// 🔥 ENSURE DOM IS READY
window.addEventListener("load", initBottomSheetDrag);
