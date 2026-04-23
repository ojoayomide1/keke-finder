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

// 🔥 Firebase config
const firebaseConfig = {
  apiKey: "AIzaSy...",
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

      // Update active ride
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

// ================= LISTENERS =================
function startListeners() {

  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(requestQuery, (snapshot) => {
    if (!map) return;

    // clear markers
    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat || !r.lng) return;

      // 🔴 student marker
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        fillColor: "red",
        color: "darkred",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map);

      // ACCEPT RIDE
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

      // ================= TRACKING =================
      if (r.status === "accepted" && r.riderLat && r.riderLng) {

        // remove old line
        if (window.rideLine) map.removeLayer(window.rideLine);

        // draw line
        window.rideLine = L.polyline([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ], { color: "green", weight: 5 }).addTo(map);

        // rider marker
        if (window.riderMarker) map.removeLayer(window.riderMarker);

        window.riderMarker = L.marker([r.riderLat, r.riderLng])
          .addTo(map)
          .bindPopup("🚖 Rider");

        // distance
        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        // UI UPDATE (bottom sheet)
        const title = document.getElementById("rideTitle");
        const sub = document.getElementById("rideSub");
        const controls = document.getElementById("rideControls");

        if (title && sub && controls) {

          if (r.status === "accepted") {
            title.innerText = "🚗 Rider on the way";
            sub.innerText = `${Math.round(dist)} meters away`;
            controls.classList.remove("hidden");
          }

          else if (r.status === "arriving") {
            title.innerText = "📍 Rider arriving";
            sub.innerText = "Get ready!";
            controls.classList.remove("hidden");
          }

          else if (r.status === "completed") {
            title.innerText = "✅ Ride completed";
            sub.innerText = "Thanks for using Keke Finder!";
            controls.classList.add("hidden");
          }
        }

        // fit map
        const bounds = L.latLngBounds([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    });
  });
}
