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
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

// Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let map = null;
window.markers = [];
window.requestMarkers = [];
window.userMarker = null;
window.rideLine = null;

// 🗺️ INIT MAP
window.initMap = function (mapId) {
  if (map) map.remove();

  map = L.map(mapId).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  startListeners(); // 🔥 start AFTER map exists
};

// 🔘 ROLE SELECT
window.selectRole = function (role) {
  document.getElementById("roleSelect").style.display = "none";

  if (role === "student") {
    document.getElementById("studentUI").style.display = "block";
    setTimeout(() => initMap("studentMap"), 100);
  } else {
    document.getElementById("riderUI").style.display = "block";
    setTimeout(() => initMap("riderMap"), 100);
  }
};

// 🔙 BACK
window.goBack = function () {
  document.getElementById("studentUI").style.display = "none";
  document.getElementById("riderUI").style.display = "none";
  document.getElementById("roleSelect").style.display = "block";

  if (map) {
    map.remove();
    map = null;
  }
};

// 🚖 RIDER
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("GPS not supported");
    return;
  }

  navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    console.log("Live rider:", lat, lng);

    // 🔥 Update instead of adding new docs every time
    if (!window.riderDocId) {
      const docRef = await addDoc(collection(db, "kekes"), {
        name,
        lat,
        lng,
        time: Date.now()
      });
      window.riderDocId = docRef.id;
    } else {
      await updateDoc(doc(db, "kekes", window.riderDocId), {
        lat,
        lng,
        time: Date.now()
      });
    }

    map.setView([lat, lng], 16);

  }, () => {
    alert("Location error");
  }, {
    enableHighAccuracy: true,
    maximumAge: 0
  });
};

// 🎯 STUDENT
window.requestKeke = function () {
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    await addDoc(collection(db, "requests"), {
      lat: latitude,
      lng: longitude,
      status: "waiting",
      time: Date.now()
    });

    map.setView([latitude, longitude], 16);

    if (window.userMarker) map.removeLayer(window.userMarker);

    window.userMarker = L.marker([latitude, longitude])
      .addTo(map)
      .bindPopup("📍 You are here")
      .openPopup();

  }, () => alert("Location error"));
};

// 🔥 START ALL LISTENERS
function startListeners() {

  // 🚖 KEKES
  const kekeQuery = query(collection(db, "kekes"), orderBy("time", "desc"));

  onSnapshot(kekeQuery, (snapshot) => {
    window.markers.forEach(m => map.removeLayer(m));
    window.markers = [];

    snapshot.forEach(doc => {
      const k = doc.data();
      if (!k.lat) return;

      const marker = L.marker([k.lat, k.lng])
        .addTo(map)
        .bindPopup(`🚖 ${k.name}`);

      window.markers.push(marker);
    });
  });

  // 📍 REQUESTS
  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

  onSnapshot(requestQuery, (snapshot) => {

    window.requestMarkers.forEach(m => map.removeLayer(m));
    window.requestMarkers = [];

    snapshot.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.lat) return;

      // 🔴 request marker
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        fillColor: "red",
        color: "#800000",
        fillOpacity: 0.8
      }).addTo(map);

      // click to accept
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
        });
      });

      window.requestMarkers.push(marker);

      // 🟢 draw line if accepted
      if (r.status === "accepted" && r.riderLat) {

        if (window.rideLine) map.removeLayer(window.rideLine);

        window.rideLine = L.polyline([
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        ], { color: "green", weight: 5 }).addTo(map);

        const dist = map.distance(
          [r.riderLat, r.riderLng],
          [r.lat, r.lng]
        );

        const msg = document.getElementById("studentMsg") || document.getElementById("riderMsg");
        if (msg) msg.innerText = `🚗 ${Math.round(dist)} meters away`;
      }
    });
  });
}
