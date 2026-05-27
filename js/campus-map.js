import { CAMPUS_MAP_DATA } from "./campus-data.js";
import { initCampusEditor } from "./campus-editor.js";

const CATEGORY_META = {
  academic: { label: "Academic", icon: "fa-graduation-cap", color: "#3b82f6" },
  food: { label: "Food", icon: "fa-utensils", color: "#f97316" },
  gate: { label: "Gate", icon: "fa-archway", color: "#22c55e" },
  hostel: { label: "Hostel", icon: "fa-bed", color: "#a855f7" },
  landmark: { label: "Landmark", icon: "fa-location-dot", color: "#ff5e1a" },
  pickup: { label: "Pickup", icon: "fa-car-side", color: "#00c48c" },
  service: { label: "Service", icon: "fa-circle-info", color: "#06b6d4" },
  sport: { label: "Sport", icon: "fa-dumbbell", color: "#ef4444" },
  study: { label: "Study", icon: "fa-book-open", color: "#6366f1" }
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.landmark;
}

function createCampusIcon(category) {
  const meta = getCategoryMeta(category);
  return L.divIcon({
    html: `
      <div class="campus-marker" style="--marker-color: ${meta.color}">
        <i class="fas ${meta.icon}"></i>
      </div>
    `,
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -30]
  });
}

function campusPopup(location) {
  const meta = getCategoryMeta(location.category);
  return `
    <div class="campus-popup">
      <strong>${location.name}</strong>
      <span>${meta.label}</span>
    </div>
  `;
}

export function renderCampusMapData(map) {
  CAMPUS_MAP_DATA.zones.forEach(zone => {
    L.polygon(zone.points, {
      color: "#ffb800",
      fillColor: "#ffb800",
      fillOpacity: 0.12,
      weight: 2,
      dashArray: "8 8"
    }).addTo(map).bindPopup(zone.name);
  });

  CAMPUS_MAP_DATA.paths.forEach(path => {
    L.polyline(path.points, {
      color: "#ff5e1a",
      weight: 5,
      opacity: 0.75,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map).bindPopup(path.name);
  });

  CAMPUS_MAP_DATA.locations.forEach(location => {
    L.marker([location.lat, location.lng], {
      icon: createCampusIcon(location.category)
    })
      .addTo(map)
      .bindPopup(campusPopup(location));
  });
}

export function initCampusMapTools(map, mapId) {
  renderCampusMapData(map);
  initCampusEditor(map, { enabled: mapId === "pathfinderMap" });
}
