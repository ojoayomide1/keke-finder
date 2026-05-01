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
  apiKey: "AIza...",   // ← Put your real key
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
let currentRole = null;
let currentRideId = null;

// ================= MAP =================
function initMap(mapId) {
  if (map) map.remove();

  map = L.map(mapId, { tap: false }).setView([9.0579, 7.4951], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 400);
}

// ================= ROLE =================
window.selectRole = (role) => {
  currentRole = role;
  document.getElementById("roleSelect").classList.add("hidden");

  if (role === "student") {
    document.getElementById("studentUI").classList.remove("hidden");
    setTimeout(() => initMap("studentMap"), 100);
  } else {
    document.getElementById("riderUI").classList.remove("hidden");
    setTimeout(() => initMap("riderMap"), 100);
  }
};

window.goBack = () => {
  document.getElementById("studentUI").classList.add("hidden");
  document.getElementById("riderUI").classList.add("hidden");
  document.getElementById("roleSelect").classList.remove("hidden");
  if (map) map.remove();
};

// ================= BOTTOM SHEET HELPERS =================
function getActiveSheet() {
  return currentRole === "student" 
    ? document.getElementById("studentSheet") 
    : document.getElementById("riderSheet");
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

    try {
      const ref = await addDoc(collection(db, "requests"), {
        lat: latitude,
        lng: longitude,
        status: "waiting",
        time: Date.now()
      });

      currentRideId = ref.id;
      map.setView([latitude, longitude], 16);

      L.marker([latitude, longitude]).addTo(map).bindPopup("📍 You");

      updateBottomSheet("🔍 Searching for rider...", "Waiting...");
    } catch (e) {
      alert("Error: " + e.message);
    }
  });
};

// ================= RIDER =================
window.becomeAvailable = () => {
  const name = prompt("Enter your rider name:");
  if (!name) return;

  updateBottomSheet("🟢 You're Online", "Waiting for requests...");

  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    console.log("Rider location:", latitude, longitude);
    // You can expand this later
  });
};

// Status functions
window.setArriving = () => updateBottomSheet("📍 Arriving", "Rider is close");
window.completeRide = () => updateBottomSheet("✅ Ride Completed", "Thank you!");

// ================= DRAG =================
function initBottomSheetDrag() {
  document.querySelectorAll(".bottomSheet").forEach(sheet => {
    const dragZone = sheet.querySelector(".dragZone");
    if (!dragZone) return;

    let startY = 0, offset = 0, dragging = false;

    const start = (y) => { dragging = true; startY = y - offset; };
    const move = (y) => {
      if (!dragging) return;
      offset = Math.max(-280, Math.min(0, y - startY));
      sheet.style.transform = `translateY(${offset}px)`;
    };
    const end = () => {
      dragging = false;
      offset = offset < -140 ? -280 : 0;
      sheet.style.transform = `translateY(${offset}px)`;
    };

    dragZone.addEventListener("touchstart", e => start(e.touches[0].clientY), { passive: true });
    dragZone.addEventListener("touchmove", e => move(e.touches[0].clientY), { passive: true });
    dragZone.addEventListener("touchend", end);
  });
}

window.addEventListener("load", () => {
  initBottomSheetDrag();
  console.log("✅ Keke Finder loaded");
});
