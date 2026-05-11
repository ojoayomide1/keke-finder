import { state } from "./state.js";
import { renderCampusMapData } from "../campus-map.js";

export function animateMarker(marker, targetLat, targetLng, duration = 1000) {
  if (!marker) return;
  if (state.activeMarkerAnimations.has(marker)) {
    cancelAnimationFrame(state.activeMarkerAnimations.get(marker));
  }
  const startLat = marker.getLatLng().lat;
  const startLng = marker.getLatLng().lng;
  const startTime = performance.now();
  function frame(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const currentLat = startLat + (targetLat - startLat) * progress;
    const currentLng = startLng + (targetLng - startLng) * progress;
    marker.setLatLng([currentLat, currentLng]);
    if (progress < 1) {
      state.activeMarkerAnimations.set(marker, requestAnimationFrame(frame));
    } else {
      state.activeMarkerAnimations.delete(marker);
    }
  }
  state.activeMarkerAnimations.set(marker, requestAnimationFrame(frame));
}

export function getDistance(lat1, lon1, lat2, lng2) {
  if (!lat1 || !lon1 || !lat2 || !lng2) return 0;
  const R = 6371e3; 
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lon1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

export function initMap(mapId) {
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  state.riderMarker = null;
  state.userMarker = null;
  state.routeControl = null;
  state.requestMarkers = [];
  
  state.map = L.map(mapId, { tap: false }).setView([9.2880, 7.4130], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(state.map);
  
  renderCampusMapData(state.map);
  setTimeout(() => state.map && state.map.invalidateSize(), 500);
}
