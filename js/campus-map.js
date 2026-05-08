import { CAMPUS_MAP_DATA } from "./campus-data.js";

export function renderCampusMapData(map) {
  CAMPUS_MAP_DATA.zones.forEach(zone => {
    L.polygon(zone.points, {
      color: "#f59e0b",
      fillColor: "#f59e0b",
      fillOpacity: 0.16,
      weight: 3
    }).addTo(map).bindPopup(zone.name);
  });

  CAMPUS_MAP_DATA.paths.forEach(path => {
    L.polyline(path.points, {
      color: "#2563eb",
      weight: 5
    }).addTo(map).bindPopup(path.name);
  });

  CAMPUS_MAP_DATA.locations.forEach(location => {
    L.marker([location.lat, location.lng])
      .addTo(map)
      .bindPopup(location.name);
  });
}
