import {
  db,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "./firebase.js";

// Toggle this off before production if the in-app coordinate editor should be hidden.
export const CAMPUS_EDITOR_MODE = true;

export const CAMPUS_CATEGORY_META = {
  boys_hostel: { label: "Boys Hostels", icon: "fa-bed", color: "#2563eb" },
  girls_hostel: { label: "Girls Hostels", icon: "fa-person-dress", color: "#db2777" },
  faculty: { label: "Faculties", icon: "fa-graduation-cap", color: "#7c3aed" },
  block: { label: "Blocks", icon: "fa-building", color: "#475569" },
  hall: { label: "Halls", icon: "fa-chalkboard-user", color: "#ea580c" },
  restaurant: { label: "Restaurants", icon: "fa-utensils", color: "#16a34a" },
  gate: { label: "Gates", icon: "fa-archway", color: "#0f766e" },
  sport: { label: "Sports", icon: "fa-basketball", color: "#dc2626" },
  service: { label: "Services", icon: "fa-circle-info", color: "#0891b2" },
  pickup: { label: "Pickup / Drop-off", icon: "fa-car-side", color: "#00c48c" }
};

export const INDOOR_CATEGORY_META = {
  lecturer: "Lecturer / Course",
  staff: "Staff",
  lab: "Lab",
  lecture_room: "Lecture room",
  office: "Office"
};

export const CAMPUS_MAP_DATA = {
  locations: [
    { id: "hostel_l", name: "Hostel L", category: "boys_hostel", lat: null, lng: null },
    { id: "hostel_i", name: "Hostel I", category: "boys_hostel", lat: null, lng: null },
    { id: "hostel_m", name: "Hostel M", category: "boys_hostel", lat: null, lng: null },
    { id: "hostel_n", name: "Hostel N", category: "boys_hostel", lat: null, lng: null },
    { id: "hostel_s", name: "Hostel S", category: "boys_hostel", lat: null, lng: null },
    { id: "new_kelson", name: "New Kelson", category: "girls_hostel", lat: null, lng: null },
    { id: "faculty_law", name: "Faculty of Law", category: "faculty", lat: null, lng: null },
    { id: "faculty_pharmacy", name: "Faculty of Pharmacy", category: "faculty", lat: null, lng: null },
    { id: "faculty_medicine", name: "Faculty of Medicine", category: "faculty", lat: null, lng: null },
    { id: "faculty_computing", name: "Faculty of Computing (Software Building)", category: "faculty", lat: null, lng: null },
    { id: "block_a", name: "Block A", category: "block", lat: null, lng: null },
    { id: "block_b", name: "Block B", category: "block", lat: null, lng: null },
    { id: "block_c", name: "Block C", category: "block", lat: null, lng: null },
    { id: "block_d", name: "Block D", category: "block", lat: null, lng: null },
    { id: "nlt", name: "New Lecture Theatre (NLT)", category: "hall", lat: null, lng: null },
    { id: "mph", name: "Multipurpose Hall (MPH)", category: "hall", lat: null, lng: null },
    { id: "auditorium", name: "Auditorium", category: "hall", lat: null, lng: null },
    { id: "ggs", name: "GGs", category: "restaurant", lat: null, lng: null },
    { id: "munchbox", name: "MunchBox", category: "restaurant", lat: null, lng: null },
    { id: "ase_cafe", name: "Ase Cafe", category: "restaurant", lat: null, lng: null },
    { id: "school_gate", name: "School Gate", category: "gate", lat: null, lng: null },
    { id: "boys_hostel_gate", name: "Boys Hostel Gate", category: "gate", lat: null, lng: null },
    { id: "girls_hostel_gate", name: "Girls Hostel Gate", category: "gate", lat: null, lng: null },
    { id: "basketball_court", name: "Basketball Court", category: "sport", lat: null, lng: null },
    { id: "volleyball_court", name: "Volleyball Court", category: "sport", lat: null, lng: null },
    { id: "table_tennis_court", name: "Table Tennis Court", category: "sport", lat: null, lng: null },
    { id: "badminton_court", name: "Badminton Court", category: "sport", lat: null, lng: null },
    { id: "football_field", name: "Football Field", category: "sport", lat: null, lng: null },
    { id: "ict", name: "ICT", category: "service", lat: null, lng: null },
    { id: "clinic", name: "Clinic", category: "service", lat: null, lng: null },
    { id: "chapel", name: "Chapel", category: "service", lat: null, lng: null },
    { id: "senate", name: "Senate", category: "service", lat: null, lng: null }
  ],
  rideStops: [
    { id: "school_gate_stop", name: "School Gate Stop", type: "pickup_dropoff", lat: null, lng: null, serves: ["school_gate"] },
    { id: "boys_hostel_gate_stop", name: "Boys Hostel Gate Stop", type: "pickup_dropoff", lat: null, lng: null, serves: ["boys_hostel_gate", "hostel_l", "hostel_i", "hostel_m", "hostel_n", "hostel_s"] },
    { id: "girls_hostel_gate_stop", name: "Girls Hostel Gate Stop", type: "pickup_dropoff", lat: null, lng: null, serves: ["girls_hostel_gate", "new_kelson"] },
    { id: "block_d_stop", name: "Block D Stop", type: "pickup_dropoff", lat: null, lng: null, serves: ["block_d"] }
  ],
  paths: [],
  buildings: [],
  indoorLocations: [
    {
      id: "block_a_ai_lab",
      name: "AI Lab",
      category: "lab",
      buildingId: "block_a",
      floor: "",
      directions: "Inside Block A.",
      aliases: ["Artificial Intelligence Lab"],
      occupants: []
    },
    {
      id: "block_a_cbt_lab",
      name: "CBT Lab",
      category: "lab",
      buildingId: "block_a",
      floor: "",
      directions: "Inside Block A.",
      aliases: ["Computer Based Test Lab"],
      occupants: []
    },
    {
      id: "block_a_debt_recovery",
      name: "Debt Recovery Office",
      category: "office",
      buildingId: "block_a",
      floor: "",
      directions: "Inside Block A.",
      aliases: [],
      occupants: []
    }
  ]
};

const CAMPUS_DOC = doc(db, "campusData", "main");
const dataListeners = new Set();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePoint(point) {
  if (Array.isArray(point)) {
    return [Number(point[0]), Number(point[1])];
  }

  if (point && typeof point === "object") {
    return [Number(point.lat), Number(point.lng)];
  }

  return [NaN, NaN];
}

function normalizeShape(shape) {
  return {
    ...shape,
    points: Array.isArray(shape?.points)
      ? shape.points
          .map(normalizePoint)
          .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
      : []
  };
}

function serializePoint(point) {
  const [lat, lng] = normalizePoint(point);
  return { lat, lng };
}

function serializeShape(shape) {
  return {
    ...shape,
    points: Array.isArray(shape?.points)
      ? shape.points
          .map(serializePoint)
          .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      : []
  };
}

function serializeCampusDataForFirestore(data) {
  return {
    locations: clone(data.locations),
    rideStops: clone(data.rideStops),
    paths: data.paths.map(serializeShape),
    buildings: data.buildings.map(serializeShape),
    indoorLocations: clone(data.indoorLocations)
  };
}

export function hasCoordinates(item) {
  return Number.isFinite(item?.lat) && Number.isFinite(item?.lng);
}

export function getCampusMapData() {
  return CAMPUS_MAP_DATA;
}

export function getCampusLocationsForMap() {
  return CAMPUS_MAP_DATA.locations.filter(hasCoordinates);
}

export function getRideStops() {
  return CAMPUS_MAP_DATA.rideStops.filter(hasCoordinates);
}

export function getCampusDestinationLocations() {
  return CAMPUS_MAP_DATA.locations.filter(hasCoordinates);
}

export function getCampusCategoryMeta(category) {
  return CAMPUS_CATEGORY_META[category] || CAMPUS_CATEGORY_META.service;
}

export function campusDataToJson() {
  return JSON.stringify(CAMPUS_MAP_DATA, null, 2);
}

export function setCampusMapData(nextData) {
  const merged = {
    locations: Array.isArray(nextData?.locations) ? nextData.locations : [],
    rideStops: Array.isArray(nextData?.rideStops) ? nextData.rideStops : [],
    paths: Array.isArray(nextData?.paths) ? nextData.paths.map(normalizeShape) : [],
    buildings: Array.isArray(nextData?.buildings) ? nextData.buildings.map(normalizeShape) : [],
    indoorLocations: Array.isArray(nextData?.indoorLocations) ? nextData.indoorLocations : []
  };

  CAMPUS_MAP_DATA.locations = merged.locations;
  CAMPUS_MAP_DATA.rideStops = merged.rideStops;
  CAMPUS_MAP_DATA.paths = merged.paths;
  CAMPUS_MAP_DATA.buildings = merged.buildings;
  CAMPUS_MAP_DATA.indoorLocations = merged.indoorLocations;
  dataListeners.forEach(listener => listener(CAMPUS_MAP_DATA));
}

export async function loadCampusDataFromFirestore() {
  try {
    const snap = await getDoc(CAMPUS_DOC);
    if (snap.exists() && snap.data()?.mapData) {
      setCampusMapData(snap.data().mapData);
      return true;
    }
  } catch (err) {
    console.warn("Using bundled campus data:", err.code || err.message);
  }
  return false;
}

export function listenToCampusData(callback) {
  dataListeners.add(callback);
  const unsubscribeLocal = () => dataListeners.delete(callback);

  let unsubscribeRemote = null;
  try {
    unsubscribeRemote = onSnapshot(CAMPUS_DOC, (snap) => {
      if (snap.exists() && snap.data()?.mapData) {
        setCampusMapData(snap.data().mapData);
      }
      callback(CAMPUS_MAP_DATA);
    }, (err) => {
      console.warn("Campus data listener unavailable:", err.code || err.message);
      callback(CAMPUS_MAP_DATA);
    });
  } catch (err) {
    console.warn("Campus data listener failed:", err);
    callback(CAMPUS_MAP_DATA);
  }

  return () => {
    unsubscribeLocal();
    if (unsubscribeRemote) unsubscribeRemote();
  };
}

export async function saveCampusDataToFirestore(nextData) {
  setCampusMapData(nextData);
  await setDoc(CAMPUS_DOC, {
    mapData: serializeCampusDataForFirestore(CAMPUS_MAP_DATA),
    updatedAt: serverTimestamp()
  }, { merge: true });
}
