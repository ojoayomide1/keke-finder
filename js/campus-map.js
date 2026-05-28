import {
  getCampusCategoryMeta,
  getCampusLocationsForMap,
  getCampusMapData,
  getRideStops
} from "./campus-data.js";
import { initCampusEditor } from "./campus-editor.js";

function getCategoryMeta(category) {
  return getCampusCategoryMeta(category);
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
  const data = getCampusMapData();

  data.buildings.forEach(building => {
    if (!Array.isArray(building.points) || building.points.length < 3) return;
    L.polygon(building.points, {
      color: "#9ca3af",
      fillColor: "#c7ccd4",
      fillOpacity: 0.55,
      weight: 1.5
    }).addTo(map).bindPopup(building.name);
  });

  data.paths.forEach(path => {
    if (!Array.isArray(path.points) || path.points.length < 2) return;
    L.polyline(path.points, {
      color: "#9ca3af",
      weight: 2,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map).bindPopup(path.name);
  });

  getCampusLocationsForMap().forEach(location => {
    L.marker([location.lat, location.lng], {
      icon: createCampusIcon(location.category)
    })
      .addTo(map)
      .bindPopup(campusPopup(location));
  });

  getRideStops().forEach(stop => {
    L.marker([stop.lat, stop.lng], {
      icon: createCampusIcon("pickup")
    })
      .addTo(map)
      .bindPopup(campusPopup({ ...stop, category: "pickup" }));
  });
}

export function initCampusMapTools(map, mapId) {
  renderCampusMapData(map);
  initCampusEditor(map, { enabled: mapId === "pathfinderMap" });
}
