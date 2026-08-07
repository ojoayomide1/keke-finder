import {
  getCampusCategoryMeta,
  getCampusLocationsForMap,
  getCampusMapData,
  getRideStops
} from "./campus-data.js";

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
    if (Array.isArray(path.corridorPoints) && path.corridorPoints.length >= 3) {
      L.polygon(path.corridorPoints, {
        color: "#94a3b8",
        fillColor: "#e2e8f0",
        fillOpacity: 0.42,
        weight: 1,
        interactive: false
      }).addTo(map);
    }
    // White outline drawn first so it sits behind the orange line,
    // visually covering the default tile roads underneath
    L.polyline(path.points, {
      color: "#ffffff",
      weight: 9,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
      interactive: false
    }).addTo(map);
    // Orange fill line on top
    L.polyline(path.points, {
      color: "#f97316",
      weight: 5,
      opacity: 1,
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
  // Student-facing campus editor removed; admin uses admin-editor.js instead
}
