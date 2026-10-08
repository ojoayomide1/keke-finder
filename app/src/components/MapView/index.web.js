/**
 * index.web.js — Web MapView using React-Leaflet.
 *
 * On web:  react-leaflet (OpenStreetMap tiles, real zoom/pan, category markers)
 * On native: react-native-maps (unchanged — this file is never loaded on native)
 *
 * campusData prop (web-only):
 *   { buildings, paths, locations, rideStops }
 *   Passed directly from MapScreen so we never create 1000+ React children.
 *
 * Dynamic overlays (walk route, rider pin, etc.) still use the standard
 * <Marker> / <Polyline> children API — there are only a handful at a time.
 */

import React, {
  useEffect,
  useRef,
  useMemo,
} from "react";
import { View, StyleSheet } from "react-native";

// ─── Re-exported constants (match react-native-maps API) ─────────────────────
export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE  = "google";

// ─── Stub components — return null, detected via displayName ─────────────────
export function Marker({ coordinate, title, description, onPress, children }) {
  return null;
}
Marker.displayName = "MapViewMarker";

export function Polyline({
  coordinates, strokeColor, strokeWidth, lineDashPattern,
}) {
  return null;
}
Polyline.displayName = "MapViewPolyline";

// ─── Type helpers ─────────────────────────────────────────────────────────────
function isMarker(el) {
  return el?.type?.displayName === "MapViewMarker";
}
function isPolyline(el) {
  return el?.type?.displayName === "MapViewPolyline";
}
function flattenChildren(nodes, out = []) {
  React.Children.forEach(nodes, (child) => {
    if (!child) return;
    if (Array.isArray(child)) flattenChildren(child, out);
    else {
      out.push(child);
      if (child.props?.children) flattenChildren(child.props.children, out);
    }
  });
  return out;
}

// ─── Category → emoji + color ────────────────────────────────────────────────
const CATEGORY_STYLE = {
  boys_hostel:  { emoji: "🛏️",  color: "#2563eb", label: "Boys Hostel"  },
  girls_hostel: { emoji: "🛏️",  color: "#db2777", label: "Girls Hostel" },
  faculty:      { emoji: "🎓",  color: "#7c3aed", label: "Faculty"      },
  Faculty:      { emoji: "🎓",  color: "#7c3aed", label: "Faculty"      },
  block:        { emoji: "🏢",  color: "#475569", label: "Block"        },
  hall:         { emoji: "🏛️",  color: "#ea580c", label: "Hall"         },
  restaurant:   { emoji: "🍽️",  color: "#16a34a", label: "Restaurant"   },
  resturant:    { emoji: "🍽️",  color: "#16a34a", label: "Restaurant"   },
  gate:         { emoji: "🚧",  color: "#0f766e", label: "Gate"         },
  sport:        { emoji: "⚽",  color: "#dc2626", label: "Sport"        },
  service:      { emoji: "ℹ️",  color: "#0891b2", label: "Service"      },
  shop:         { emoji: "🛒",  color: "#ca8a04", label: "Shop"         },
  pickup:       { emoji: "🛺",  color: "#00c48c", label: "Pickup Stop"  },
};

function getCatStyle(category) {
  return CATEGORY_STYLE[category] ?? { emoji: "📍", color: "#64748b", label: category ?? "Place" };
}

// ─── Build a Leaflet DivIcon for a category ───────────────────────────────────
function makeDivIcon(L, category, isStop = false) {
  const { emoji, color } = getCatStyle(category);
  const html = `
    <div style="
      background:${color};
      color:#fff;
      width:32px;height:32px;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:16px;
      border:2.5px solid rgba(255,255,255,0.85);
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
      cursor:pointer;
    ">${isStop ? "🛺" : emoji}</div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize:   [32, 32],
    iconAnchor: [16, 16],
    popupAnchor:[0, -18],
  });
}

// ─── Main MapView component ───────────────────────────────────────────────────
const MapView = React.forwardRef(function MapView({
  style,
  children,
  initialRegion,
  region,
  campusData,
  // native-only props ignored on web:
  provider, mapType, showsUserLocation, showsMyLocationButton, onRegionChange,
}, ref) {
  const mapRef      = useRef(null);   // Leaflet map instance
  const layerGroups = useRef({});     // { campus, overlayPoly, overlayMarker }
  const containerRef = useRef(null);

  // ── Parse overlay children ────────────────────────────────────────────────
  const { overlayMarkers, overlayPolylines } = useMemo(() => {
    const flat = flattenChildren(children);
    return {
      overlayMarkers:   flat.filter(isMarker),
      overlayPolylines: flat.filter(isPolyline),
    };
  }, [children]);

  const buildings = campusData?.buildings  ?? [];
  const paths     = campusData?.paths      ?? [];
  const locations = campusData?.locations  ?? [];
  const rideStops = campusData?.rideStops  ?? [];

  // ── Bootstrap Leaflet once on mount ───────────────────────────────────────
  useEffect(() => {
    // Leaflet must be imported client-side (it accesses window/document)
    let L;
    try { L = require("leaflet"); } catch { return; }

    // Fix default marker icon path broken by bundlers
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    const center = [
      initialRegion?.latitude  ?? region?.latitude  ?? 9.2868,
      initialRegion?.longitude ?? region?.longitude ?? 7.4114,
    ];

    const map = L.map(containerRef.current, {
      center,
      zoom:        16,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    // ── Tile layer: OpenStreetMap ────────────────────────────────────────
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    // ── Layer groups ────────────────────────────────────────────────────
    layerGroups.current.campus        = L.layerGroup().addTo(map);
    layerGroups.current.overlayPoly   = L.layerGroup().addTo(map);
    layerGroups.current.overlayMarker = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inject Leaflet CSS once ────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("leaflet-css")) return;
    const link = document.createElement("link");
    link.id   = "leaflet-css";
    link.rel  = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }, []);

  // ── Render static campus data ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let L;
    try { L = require("leaflet"); } catch { return; }

    const group = layerGroups.current.campus;
    group.clearLayers();

    // Building polygons
    for (const b of buildings) {
      if (!b.points?.length) continue;
      const latlngs = b.points.map(([lat, lng]) => [lat, lng]);
      L.polygon(latlngs, {
        color:       "#7A8BAD",
        weight:      1.5,
        fillColor:   "#C8D6EE",
        fillOpacity: 0.55,
      }).bindTooltip(b.name || b.id, { sticky: true, className: "navcamp-tooltip" })
        .addTo(group);
    }

    // Roads & walkways
    for (const p of paths) {
      if (!p.points?.length) continue;
      const latlngs = p.points.map(([lat, lng]) => [lat, lng]);
      const isWalkway = p.type === "walkway";
      L.polyline(latlngs, {
        color:     isWalkway ? "#94A3B8" : "#64748B",
        weight:    isWalkway ? 2 : 3,
        dashArray: isWalkway ? "5, 4" : null,
        opacity:   0.75,
      }).addTo(group);
    }

    // Location markers
    for (const loc of locations) {
      if (!loc.lat || !loc.lng) continue;
      const icon = makeDivIcon(L, loc.category);
      const { label } = getCatStyle(loc.category);
      L.marker([loc.lat, loc.lng], { icon })
        .bindPopup(`<b>${loc.name}</b><br><small>${label}</small>`)
        .addTo(group);
    }

    // Ride stop markers
    for (const stop of rideStops) {
      if (!stop.lat || !stop.lng) continue;
      const icon = makeDivIcon(L, "pickup", true);
      L.marker([stop.lat, stop.lng], { icon })
        .bindPopup(`<b>${stop.name}</b><br><small>Pickup / Drop-off</small>`)
        .addTo(group);
    }

    // Auto-fit bounds to all features
    const allPts = [
      ...locations.map(l => [l.lat, l.lng]),
      ...rideStops.map(s => [s.lat, s.lng]),
    ].filter(([lat, lng]) => lat && lng);

    if (allPts.length > 1) {
      map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 17 });
    }
  }, [buildings, paths, locations, rideStops]);

  // ── Render dynamic overlay polylines (walk route, trip line) ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let L;
    try { L = require("leaflet"); } catch { return; }

    const group = layerGroups.current.overlayPoly;
    group.clearLayers();

    for (const poly of overlayPolylines) {
      const coords = poly.props?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const latlngs = coords.map(c => [c.latitude ?? c[0], c.longitude ?? c[1]]);
      const color = poly.props?.strokeColor ?? "#00C48C";
      L.polyline(latlngs, {
        color,
        weight:    (poly.props?.strokeWidth ?? 3) + 1,
        dashArray: poly.props?.lineDashPattern ? "8, 6" : null,
        opacity:   1,
      }).addTo(group);
    }
  }, [overlayPolylines]);

  // ── Render dynamic overlay markers (rider, user location) ────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let L;
    try { L = require("leaflet"); } catch { return; }

    const group = layerGroups.current.overlayMarker;
    group.clearLayers();

    for (const m of overlayMarkers) {
      const coord = m.props?.coordinate;
      if (!coord || !coord.latitude) continue;
      const title = m.props?.title ?? "";
      const icon  = L.divIcon({
        html: `<div style="
          background:#00C48C;color:#fff;
          padding:3px 8px;border-radius:10px;
          font-size:11px;font-weight:700;
          white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          border:1.5px solid rgba(255,255,255,0.7);
        ">${title || "📍"}</div>`,
        className:  "",
        iconAnchor: [0, 0],
      });
      const marker = L.marker([coord.latitude, coord.longitude], { icon });
      if (m.props?.onPress) marker.on("click", m.props.onPress);
      marker.addTo(group);
    }
  }, [overlayMarkers]);

  // ── Expose animateToRegion / fitToCoordinates via forwarded ref ──────────
  useEffect(() => {
    if (!ref) return;
    const api = {
      animateToRegion(reg) {
        mapRef.current?.setView([reg.latitude, reg.longitude], 16, { animate: true });
      },
      fitToCoordinates(coords) {
        if (!coords?.length || !mapRef.current) return;
        let L;
        try { L = require("leaflet"); } catch { return; }
        const bounds = L.latLngBounds(coords.map(c => [c.latitude, c.longitude]));
        mapRef.current.fitBounds(bounds, { padding: [40, 40] });
      },
    };
    if (typeof ref === "function") ref(api);
    else ref.current = api;
  }, [ref]);

  return (
    <View style={[styles.root, style]}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", position: "relative" }}
      />
    </View>
  );
});

export default MapView;

const styles = StyleSheet.create({
  root: {
    flex:     1,
    overflow: "hidden",
  },
});
