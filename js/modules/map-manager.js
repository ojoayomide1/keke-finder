import { state } from "./state.js";
import { renderCampusMapData } from "../campus-map.js";

// Location Stabilizer State
const stabilizer = {
  lastLat: null,
  lastLng: null,
  smoothingFactor: 0.3 // Adjust (0 to 1): Lower is smoother but has more lag
};

/**
 * Smoothens raw GPS coordinates using Exponential Moving Average (EMA).
 * This reduces sudden jumps and "jitters".
 */
export function stabilizeLocation(lat, lng) {
  if (stabilizer.lastLat === null || stabilizer.lastLng === null) {
    stabilizer.lastLat = lat;
    stabilizer.lastLng = lng;
    return { lat, lng };
  }

  // EMA Formula: NewValue = (RawValue * Factor) + (OldValue * (1 - Factor))
  const smoothLat = (lat * stabilizer.smoothingFactor) + (stabilizer.lastLat * (1 - stabilizer.smoothingFactor));
  const smoothLng = (lng * stabilizer.smoothingFactor) + (stabilizer.lastLng * (1 - stabilizer.smoothingFactor));

  stabilizer.lastLat = smoothLat;
  stabilizer.lastLng = smoothLng;

  return { lat: smoothLat, lng: smoothLng };
}

export function animateMarker(marker, targetLat, targetLng, duration = 1200) {
  if (!marker) return;
  
  if (state.activeMarkerAnimations.has(marker)) {
    cancelAnimationFrame(state.activeMarkerAnimations.get(marker));
  }

  const startLat = marker.getLatLng().lat;
  const startLng = marker.getLatLng().lng;
  const startTime = performance.now();

  // Easing function for a "gliding" feel
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function frame(currentTime) {
    const elapsed = currentTime - startTime;
    const rawProgress = Math.min(elapsed / duration, 1);
    const progress = easeOutCubic(rawProgress);

    const currentLat = startLat + (targetLat - startLat) * progress;
    const currentLng = startLng + (targetLng - startLng) * progress;

    marker.setLatLng([currentLat, currentLng]);

    if (rawProgress < 1) {
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

function getTileLayerConfig() {
  const isLight = document.body?.classList.contains("light-theme");
  return {
    url: isLight
      ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 20
    }
  };
}

export function refreshMapTheme() {
  if (!state.map) return;
  const { url, options } = getTileLayerConfig();
  if (state.tileLayer) {
    try { state.map.removeLayer(state.tileLayer); } catch (e) { console.warn("Map theme refresh warning:", e); }
  }
  state.tileLayer = L.tileLayer(url, options).addTo(state.map);
}

export function initMap(mapId) {
  if (state.map) {
    try {
      // Explicitly remove routing control before destroying map
      if (state.routeControl && state.map.hasLayer(state.routeControl)) {
        state.map.removeControl(state.routeControl);
      }
      state.map.remove();
    } catch (e) {
      console.warn("Map cleanup warning:", e);
    }
    state.map = null;
  }
  state.riderMarker = null;
  state.userMarker = null;
  state.routeControl = null;
  state.tileLayer = null;
  state.requestMarkers = [];
  state.activeMarkerAnimations.forEach(id => cancelAnimationFrame(id));
  state.activeMarkerAnimations.clear();
  
  const mapElement = document.getElementById(mapId);
  if (!mapElement) return;
  if (mapElement.offsetParent === null) return;

  state.map = L.map(mapId, { tap: false, zoomControl: false }).setView([9.2880, 7.4130], 16);
  
  const { url, options } = getTileLayerConfig();
  state.tileLayer = L.tileLayer(url, options).addTo(state.map);
  
  renderCampusMapData(state.map);
  setTimeout(() => state.map && state.map.invalidateSize(), 500);
}

// Custom icons for the new design
export const kekeIcon = L.divIcon({
  html: `<div style="
    width: 36px;
    height: 36px;
    background: #FF5E1A;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    border: 3px solid white;
    box-shadow: 0 4px 12px rgba(255,94,26,0.5);
  "></div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 36]
});

export const pickupIcon = L.divIcon({
  html: `<div style="
    width: 14px;
    height: 14px;
    background: #00C48C;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,196,140,0.5);
  "></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});
