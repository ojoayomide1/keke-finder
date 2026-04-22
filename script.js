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
const map = L.map('map').setView([9.0579, 7.4951], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19
}).addTo(map);


// GLOBAL STORAGE
window.markers = [];
window.userMarker = null;


// 🔘 ROLE SELECT
window.selectRole = function (role) {
  document.getElementById("roleSelect").style.display = "none";

  if (role === "student") {
    document.getElementById("studentUI").style.display = "block";
  } else {
    document.getElementById("riderUI").style.display = "block";
  }
};


// 🔙 BACK BUTTON
window.goBack = function () {
  document.getElementById("studentUI").style.display = "none";
  document.getElementById("riderUI").style.display = "none";
  document.getElementById("roleSelect").style.display = "block";
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
      alert("Location error");
      console.error(error);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
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
    (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      console.log("Student GPS:", lat, lng);

      map.setView([lat, lng], 16);

      if (window.userMarker) {
        map.removeLayer(window.userMarker);
      }

      window.userMarker = L.marker([lat, lng])
        .addTo(map)
        .bindPopup("📍 You are here")
        .openPopup();

      document.getElementById("studentMsg").innerText =
        "🔍 Searching...";
    },
    (error) => {
      alert("Location error");
      console.error(error);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
};


// 🔥 REAL-TIME DATABASE LISTENER
const q = query(collection(db, "kekes"), orderBy("time", "desc"));

onSnapshot(q, (snapshot) => {
  const list = document.getElementById("kekeList");
  if (!list) return;

  list.innerHTML = "";

  // Clear old markers safely
  window.markers.forEach(marker => map.removeLayer(marker));
  window.markers = [];

  const bounds = L.latLngBounds(); // 🔥 for auto zoom

  snapshot.forEach((doc) => {
    const keke = doc.data();

    if (!keke.lat || !keke.lng) return;

    console.log("Keke:", keke.name, keke.lat, keke.lng);

    // Add to list
    const li = document.createElement("li");
    li.innerHTML = `🚖 <strong>${keke.name}</strong>`;
    list.appendChild(li);

    // Add marker
    const marker = L.marker([keke.lat, keke.lng])
      .addTo(map)
      .bindPopup(`🚖 ${keke.name}`);

    window.markers.push(marker);

    // Extend bounds
    bounds.extend([keke.lat, keke.lng]);
  });

  // 🔥 THIS IS THE FIX
  if (window.markers.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] });

    document.getElementById("studentMsg").innerText =
      "🚖 Kekes available!";
  } else {
    document.getElementById("studentMsg").innerText =
      "No keke available 😢";
  }
});
