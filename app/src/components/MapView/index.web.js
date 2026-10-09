/**
 * index.web.js — Web MapView using Leaflet.
 *
 * - Plain light background (no OSM tiles — no visual clutter)
 * - Campus buildings + roads drawn as clean SVG vectors
 * - Category markers: coloured circle + emoji, NO label unless clicked
 * - Click marker → popup shows name + category
 * - Full scroll/zoom/pan from Leaflet
 *
 * Native (iOS/Android) uses react-native-maps — this file is never loaded there.
 */

import React, { useEffect, useRef, useMemo } from "react";
import { View, StyleSheet } from "react-native";

export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE  = "google";

// ─── Stub components (return null, detected via displayName) ─────────────────
export function Marker({ coordinate, title, description, onPress, children }) {
  return null;
}
Marker.displayName = "MapViewMarker";

export function Polyline({ coordinates, strokeColor, strokeWidth, lineDashPattern }) {
  return null;
}
Polyline.displayName = "MapViewPolyline";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isMarker(el)   { return el?.type?.displayName === "MapViewMarker";   }
function isPolyline(el) { return el?.type?.displayName === "MapViewPolyline"; }

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

// ─── Category styles ──────────────────────────────────────────────────────────
const CAT = {
  boys_hostel:  { emoji: "🛏️", color: "#2563eb", label: "Boys Hostel"    },
  girls_hostel: { emoji: "🛏️", color: "#db2777", label: "Girls Hostel"   },
  faculty:      { emoji: "🎓", color: "#1E7A46", label: "Faculty"        },
  Faculty:      { emoji: "🎓", color: "#1E7A46", label: "Faculty"        },
  block:        { emoji: "🏢", color: "#475569", label: "Block"          },
  hall:         { emoji: "🏛️", color: "#ea580c", label: "Hall"           },
  restaurant:   { emoji: "🍽️", color: "#16a34a", label: "Restaurant"     },
  resturant:    { emoji: "🍽️", color: "#16a34a", label: "Restaurant"     },
  gate:         { emoji: "🚧", color: "#0f766e", label: "Gate"           },
  sport:        { emoji: "⚽", color: "#dc2626", label: "Sports"         },
  service:      { emoji: "ℹ️", color: "#0891b2", label: "Service"        },
  shop:         { emoji: "🛒", color: "#ca8a04", label: "Shop"           },
  pickup:       { emoji: "🛺", color: "#F5A623", label: "Pickup / Stop"  },
};

function cat(category) {
  return CAT[category] ?? { emoji: "📍", color: "#64748b", label: category ?? "Place" };
}

function makeDivIcon(L, style, size = 30) {
  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${style.color};
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${Math.round(size * 0.52)}px;
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 2px 6px rgba(0,0,0,0.28);
      cursor:pointer;box-sizing:border-box;
    ">${style.emoji}</div>`,
    className:  "",
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor:[0, -(size / 2 + 4)],
  });
}

// ─── Inject Leaflet CSS once ──────────────────────────────────────────────────
function injectLeafletCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("leaflet-css")) return;
  const link = document.createElement("link");
  link.id   = "leaflet-css";
  link.rel  = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);

  const style = document.createElement("style");
  style.textContent = `
    /* Solid background — no tile grid, no glowing boxes */
    .leaflet-container {
      background: #EEF2FA !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    /* Hide any tile-loading placeholder boxes */
    .leaflet-tile-pane { display: none !important; }

    .navcamp-popup .leaflet-popup-content-wrapper {
      background: #FFFFFF;
      color: #0F1117;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      border: 1px solid #E2E6ED;
      padding: 0;
    }
    .navcamp-popup .leaflet-popup-content {
      margin: 10px 14px;
      font-size: 13px;
      line-height: 1.5;
    }
    .navcamp-popup .leaflet-popup-tip { background: #FFFFFF; }
    .navcamp-popup .leaflet-popup-close-button { color: #6B7280 !important; }
    .leaflet-control-zoom a {
      background: #FFFFFF !important;
      color: #0F1117 !important;
      border-color: #E2E6ED !important;
    }
    .leaflet-control-zoom a:hover { background: #2a2a35 !important; }
  `;
  document.head.appendChild(style);
}

// ─── MapView ──────────────────────────────────────────────────────────────────
const MapView = React.forwardRef(function MapView(
  {
    style, children, initialRegion, region, campusData,
    // native-only, ignored on web:
    provider, mapType, showsUserLocation, showsMyLocationButton, onRegionChange,
  },
  ref
) {
  const leafletMap   = useRef(null);
  const layers       = useRef({});
  const containerRef = useRef(null);

  // ── Parse dynamic overlay children ──────────────────────────────────────
  const { overlayMarkers, overlayPolylines } = useMemo(() => {
    const flat = flattenChildren(children);
    return { overlayMarkers: flat.filter(isMarker), overlayPolylines: flat.filter(isPolyline) };
  }, [children]);

  const buildings = campusData?.buildings ?? [];
  const paths     = campusData?.paths     ?? [];
  const locations = campusData?.locations ?? [];
  const rideStops = campusData?.rideStops ?? [];

  // ── Init Leaflet map on mount ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    injectLeafletCss();

    let L;
    try { L = require("leaflet"); } catch { return; }

    const center = [
      initialRegion?.latitude  ?? region?.latitude  ?? 9.2868,
      initialRegion?.longitude ?? region?.longitude ?? 7.4114,
    ];

    const map = L.map(containerRef.current, {
      center,
      zoom:             16,
      zoomControl:      true,
      attributionControl: false,
    });
    leafletMap.current = map;

    // No tile layer at all — plain background set via CSS on .leaflet-container.
    // Using a data-URI tile causes grey "loading" boxes on mobile; skipping it
    // entirely and setting background colour directly is much cleaner and faster.

    // ── Layer groups ─────────────────────────────────────────────────────
    layers.current.buildings      = L.layerGroup().addTo(map);
    layers.current.paths          = L.layerGroup().addTo(map);
    layers.current.locations      = L.layerGroup().addTo(map);
    layers.current.overlayPoly    = L.layerGroup().addTo(map);
    layers.current.overlayMarkers = L.layerGroup().addTo(map);

    return () => { map.remove(); leafletMap.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Expose imperative API via forwarded ref ──────────────────────────────
  useEffect(() => {
    if (!ref) return;
    const api = {
      animateToRegion(reg) {
        leafletMap.current?.setView([reg.latitude, reg.longitude], 16, { animate: true });
      },
      fitToCoordinates(coords) {
        if (!coords?.length || !leafletMap.current) return;
        let L;
        try { L = require("leaflet"); } catch { return; }
        leafletMap.current.fitBounds(
          L.latLngBounds(coords.map(c => [c.latitude, c.longitude])),
          { padding: [40, 40] }
        );
      },
    };
    if (typeof ref === "function") ref(api);
    else ref.current = api;
  }, [ref]);

  // ── Render buildings — single L.geoJSON call instead of 68 separate polygons ──
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    let L; try { L = require("leaflet"); } catch { return; }

    const group = layers.current.buildings;
    group.clearLayers();

    if (!buildings.length) return;

    // Convert to GeoJSON FeatureCollection — one call, one SVG element
    const fc = {
      type: "FeatureCollection",
      features: buildings
        .filter(b => b.points?.length >= 3)
        .map(b => ({
          type: "Feature",
          geometry: {
            type: "Polygon",
            // GeoJSON is [lng, lat]; Leaflet points are [lat, lng]
            coordinates: [b.points.map(([lat, lng]) => [lng, lat])],
          },
          properties: { name: b.name || b.id },
        })),
    };

    L.geoJSON(fc, {
      style:       { color: "#8A9BBD", weight: 1, fillColor: "#C8D6EE", fillOpacity: 0.55, interactive: false },
      interactive: false,
      renderer:    L.canvas(),
    }).addTo(group);
  }, [buildings]);

  // ── Render paths — single L.geoJSON call instead of 48 separate polylines ──
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    let L; try { L = require("leaflet"); } catch { return; }

    const group = layers.current.paths;
    group.clearLayers();

    if (!paths.length) return;

    const roads    = { type: "FeatureCollection", features: [] };
    const walkways = { type: "FeatureCollection", features: [] };

    for (const p of paths) {
      if (!p.points?.length) continue;
      const fc = p.type === "walkway" ? walkways : roads;
      fc.features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: p.points.map(([lat, lng]) => [lng, lat]),
        },
        properties: {},
      });
    }

    if (roads.features.length) {
      L.geoJSON(roads, {
        style:       { color: "#64748B", weight: 2.5, opacity: 0.7, interactive: false },
        interactive: false,
        renderer:    L.canvas(),
      }).addTo(group);
    }
    if (walkways.features.length) {
      L.geoJSON(walkways, {
        style:       { color: "#94A3B8", weight: 1.5, dashArray: "4,5", opacity: 0.65, interactive: false },
        interactive: false,
        renderer:    L.canvas(),
      }).addTo(group);
    }
  }, [paths]);

  // ── Render location + stop markers — circleMarker (SVG/canvas, no DOM per marker) ──
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    let L; try { L = require("leaflet"); } catch { return; }

    const group = layers.current.locations;
    group.clearLayers();

    // Use L.canvas() renderer — batch-renders all circles in ONE canvas element
    // instead of N separate SVG/DOM elements. Critical for mobile performance.
    const renderer = L.canvas({ padding: 0.5 });

    for (const loc of locations) {
      if (!loc.lat || !loc.lng) continue;
      const style = cat(loc.category);
      L.circleMarker([loc.lat, loc.lng], {
        radius:      7,
        color:       style.color,
        fillColor:   style.color,
        fillOpacity: 0.9,
        weight:      2,
        opacity:     1,
        renderer,
      }).bindPopup(
        `<div style="min-width:140px">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px;color:#0F1117">${loc.name}</div>
          <div style="color:#6B7280;font-size:11px">${style.label}</div>
        </div>`,
        { className: "navcamp-popup" }
      ).addTo(group);
    }

    for (const stop of rideStops) {
      if (!stop.lat || !stop.lng) continue;
      const style = cat("pickup");
      L.circleMarker([stop.lat, stop.lng], {
        radius:      10,
        color:       "#FFFFFF",
        fillColor:   "#F5A623",
        fillOpacity: 1,
        weight:      2.5,
        opacity:     1,
        renderer,
      }).bindPopup(
        `<div style="min-width:120px">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px;color:#0F1117">${stop.name}</div>
          <div style="color:#6B7280;font-size:11px">Pickup / Drop-off</div>
        </div>`,
        { className: "navcamp-popup" }
      ).addTo(group);
    }

    // Auto-fit to all markers when data first arrives
    const pts = [
      ...locations.filter(l => l.lat && l.lng).map(l => [l.lat, l.lng]),
      ...rideStops.filter(s => s.lat && s.lng).map(s => [s.lat, s.lng]),
    ];
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 17 });
    }
  }, [locations, rideStops]);

  // ── Render dynamic overlay polylines (walk route, trip dashes) ───────────
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    let L; try { L = require("leaflet"); } catch { return; }

    const group = layers.current.overlayPoly;
    group.clearLayers();

    for (const poly of overlayPolylines) {
      const coords = poly.props?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      L.polyline(
        coords.map(c => [c.latitude ?? c[0], c.longitude ?? c[1]]),
        {
          color:     poly.props?.strokeColor ?? "#1E7A46",
          weight:    (poly.props?.strokeWidth ?? 3) + 1,
          dashArray: poly.props?.lineDashPattern ? "8, 6" : null,
          opacity:   1,
        }
      ).addTo(group);
    }
  }, [overlayPolylines]);

  // ── Render dynamic overlay markers (rider pin, etc.) ─────────────────────
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;
    let L; try { L = require("leaflet"); } catch { return; }

    const group = layers.current.overlayMarkers;
    group.clearLayers();

    for (const m of overlayMarkers) {
      const coord = m.props?.coordinate;
      if (!coord?.latitude) continue;
      const title = m.props?.title ?? "";
      const icon  = L.divIcon({
        html: `<div style="
          background:#1E7A46;color:#fff;
          padding:4px 9px;border-radius:10px;
          font-size:12px;font-weight:700;
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

  return (
    <View style={[styles.root, style]}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </View>
  );
});

export default MapView;

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
});
