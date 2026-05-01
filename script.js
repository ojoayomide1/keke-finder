// script.js
import { db } from "./firebase.js";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  doc, 
  updateDoc,
  query,
  orderBy 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

let map = null;
let currentRole = null;
let currentRideId = null;

// Initialize when dashboard loads
window.addEventListener("load", () => {
  currentRole = localStorage.getItem("currentRole");

  if (!currentRole) {
    window.location.href = "index.html";
    return;
  }

  // Set title
  document.getElementById("pageTitle").textContent = 
    currentRole === "student" ? "Student Dashboard" : "Rider Dashboard";

  // Show correct view
  if (currentRole === "student") {
    document.getElementById("studentView").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 300);
  } else {
    document.getElementById("riderView").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 300);
  }

  initBottomSheetDrag();
});

// Initialize Leaflet Map
function initMap(mapId) {
  if (map) map.remove();

  map = L.map(mapId, { tap: false }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 500);
}

// Student - Request Keke
window.requestKeke = async () => {
  if (!navigator.geolocation) {
    alert("Geolocation not supported on this device");
    return;
  }

  updateBottomSheet("📍 Getting location...", "Please wait...");

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;

    try {
      const docRef = await addDoc(collection(db, "rides"), {
        type: "request",
        studentLat: latitude,
        studentLng: longitude,
        status: "waiting",
        timestamp: Date.now(),
        studentId: "test_student"   // we'll replace with real user later
      });

      currentRideId = docRef.id;
      updateBottomSheet("🔍 Searching for rider...", "A rider will accept soon");
      alert("Ride request sent successfully!");
    } catch (error) {
      alert("Failed to request ride: " + error.message);
    }
  }, (error) => {
    alert("Location error: " + error.message);
  });
};

// Rider - Go Online / Offline
window.toggleOnline = () => {
  const btn = document.getElementById("goLiveBtn");
  
  if (btn.textContent.includes("Go Online")) {
    btn.textContent = "🛑 Go Offline";
    btn.style.background = "#ef4444";
    updateBottomSheet("🟢 You're Online", "Waiting for ride requests...");
  } else {
    btn.textContent = "🟢 Go Online";
    btn.style.background = "#facc15";
    updateBottomSheet("Offline", "Tap Go Online to receive requests");
  }
};

// Update Bottom Sheet
function updateBottomSheet(title, subtitle) {
  document.getElementById("sheetTitle").textContent = title;
  document.getElementById("sheetSubtitle").textContent = subtitle;
}

// Bottom Sheet Drag (basic)
function initBottomSheetDrag() {
  console.log("Bottom sheet ready");
}

// Logout
window.logout = () => {
  localStorage.removeItem("currentRole");
  window.location.href = "index.html";
};
