import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// 🔥 Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyD7B0wPIFFs3aGZL4kaAXSAfwixo08yDf4",
  authDomain: "keke-finder-cd5fe.firebaseapp.com",
  projectId: "keke-finder-cd5fe",
  storageBucket: "keke-finder-cd5fe.firebasestorage.app",
  messagingSenderId: "836112236677",
  appId: "1:836112236677:web:bd2a64d87f093a3230e9ec"
};

// 🔥 Init Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log("Firebase connected ✅");


// 🗺️ MAP SETUP (RUNS ON PAGE LOAD)
let map = null;


// GLOBAL STORAGE
window.markers = [];
window.userMarker = null;


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


// 🔙 BACK BUTTON
window.goBack = function () {
  document.getElementById("studentUI").style.display = "none";
  document.getElementById("riderUI").style.display = "none";
  document.getElementById("roleSelect").style.display = "block";

  if (map) {
    map.remove();
    map = null;
  }
};


// 🚖 RIDER FUNCTION (FIXED GPS)
window.becomeAvailable = function () {
  const name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("GPS not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      console.log("Rider GPS:", lat, lng);

      await addDoc(collection(db, "kekes"), {
        name: name,
        lat: lat,
        lng: lng,
        time: Date.now()
      });

      map.setView([lat, lng], 16);

      L.marker([lat, lng])
        .addTo(map)
        .bindPopup("🚖 You are live")
        .openPopup();

      document.getElementById("riderMsg").innerText =
        "✅ You are now live!";
    },
    (error) => {
  console.error(error);

  let message = "Location error";

  if (error.code === 1) {
    message = "❌ Please allow location access";
  } else if (error.code === 2) {
    message = "📡 Location unavailable (turn on GPS)";
  } else if (error.code === 3) {
    message = "⏳ Location request timed out";
  }

  alert(message);
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    }
  );
};


// 🎯 STUDENT FUNCTION
window.requestKeke = function () {
  if (!navigator.geolocation) {
    alert("GPS not supported");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      console.log("Student GPS:", lat, lng);

      // 📌 Save request to database
      await addDoc(collection(db, "requests"), {
        lat: lat,
        lng: lng,
        status: "waiting",
        time: Date.now()
      });

      map.setView([lat, lng], 16);

      if (window.userMarker) {
        map.removeLayer(window.userMarker);
      }

      window.userMarker = L.marker([lat, lng])
        .addTo(map)
        .bindPopup("📍 You are here")
        .openPopup();

      document.getElementById("studentMsg").innerText =
        "📡 Request sent! Waiting for rider...";
    },
    (error) => {
      console.error(error);
      alert("Location error");
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    }
  );
};


// 🔥 REAL-TIME DATABASE LISTENER
const q = query(collection(db, "kekes"), orderBy("time", "desc"));

onSnapshot(q, (snapshot) => {

  if (!map) return; // 🔥 VERY IMPORTANT FIX

  console.log("Snapshot size:", snapshot.size);

  window.markers.forEach(marker => map.removeLayer(marker));
  window.markers = [];

  const bounds = L.latLngBounds();

  snapshot.forEach((doc) => {
    const keke = doc.data();
    if (!keke.lat || !keke.lng) return;

    const marker = L.marker([keke.lat, keke.lng])
      .addTo(map)
      .bindPopup(`🚖 ${keke.name}`);

    window.markers.push(marker);
    bounds.extend([keke.lat, keke.lng]);
  });

  if (window.markers.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });

    const msg = document.getElementById("studentMsg");
    if (msg) msg.innerText = "🚖 Kekes available!";
  }
});
const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

onSnapshot(requestQuery, (snapshot) => {

  const riderMsg = document.getElementById("riderMsg");
  if (!riderMsg) return;

  if (snapshot.empty) {
    riderMsg.innerText = "No ride requests yet";
    return;
  }
  const requestQuery = query(collection(db, "requests"), orderBy("time", "desc"));

window.requestMarkers = [];

onSnapshot(requestQuery, (snapshot) => {

  if (!map) return;

  // Clear old request markers
  window.requestMarkers.forEach(marker => map.removeLayer(marker));
  window.requestMarkers = [];

  snapshot.forEach((doc) => {
    const req = doc.data();

    if (!req.lat || !req.lng) return;

    // 🔴 Red marker for student
    const marker = L.circleMarker([req.lat, req.lng], {
      radius: 10,
      fillColor: "red",
      color: "#800000",
      weight: 2,
      fillOpacity: 0.8
    })
      .addTo(map)
      .bindPopup("📍 Student requesting ride");

    // 🔥 CLICK TO ACCEPT
    marker.on("click", async () => {
      const confirmRide = confirm("Accept this ride?");
      if (!confirmRide) return;

      await acceptRide(doc.id);
    });

    window.requestMarkers.push(marker);
  });
});

  riderMsg.innerText = "📢 New ride requests available!";
});
window.initMap = function (mapId) {
  if (map) {
    map.remove(); // destroy old map
  }

  map = L.map(mapId).setView([9.0579, 7.4951], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);
};
