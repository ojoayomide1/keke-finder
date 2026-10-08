/**
 * index.web.js — Web-only MapView for NavCamp.
 *
 * ARCHITECTURE:
 * Campus buildings and paths are passed via the `campusData` prop directly
 * (not as React children) to avoid creating thousands of React element objects.
 *
 * Dynamic overlays (walk route, rider marker, user location) still use the
 * standard <Marker> / <Polyline> children pattern — there are only a handful
 * of these at any time.
 *
 * WHY NOT CHILDREN:
 * Passing 1900+ <Polyline> elements as children creates 1900+ React element
 * objects that must be reconciled on every render. This either freezes the
 * browser or produces a blank map while React tries to process them.
 */

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";

// ─── Re-exported constants ────────────────────────────────────────────────────
export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE = "google";

// ─── Marker ───────────────────────────────────────────────────────────────────
// Returns null — MapView reads its props from the React element directly.
export function Marker({ coordinate, title, description, onPress, children }) {
  return null;
}
Marker.displayName = "MapViewMarker";

// ─── Polyline ─────────────────────────────────────────────────────────────────
export function Polyline({
  coordinates,
  strokeColor = "#64748B",
  strokeWidth = 3,
  lineDashPattern,
}) {
  return null;
}
Polyline.displayName = "MapViewPolyline";

// ─── Type detection helpers ───────────────────────────────────────────────────
function isMarker(el) {
  if (!el || !el.type) return false;
  return (
    el.type.displayName === "MapViewMarker" ||
    (typeof el.type === "function" && el.type.name === "Marker")
  );
}

function isPolyline(el) {
  if (!el || !el.type) return false;
  return (
    el.type.displayName === "MapViewPolyline" ||
    (typeof el.type === "function" && el.type.name === "Polyline")
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function flattenChildren(nodes, out = []) {
  React.Children.forEach(nodes, (child) => {
    if (!child) return;
    if (Array.isArray(child)) {
      flattenChildren(child, out);
    } else {
      out.push(child);
      if (child.props?.children) flattenChildren(child.props.children, out);
    }
  });
  return out;
}

// ─── MapView ─────────────────────────────────────────────────────────────────
/**
 * Props (web-only additions):
 *   campusData: {
 *     buildings: Array<{ points: Array<[lat, lng]> }>,
 *     paths:     Array<{ points: Array<[lat, lng]> }>,
 *     locations: Array<{ lat, lng, name, category }>,
 *   }
 */
export default function MapView({
  style,
  children,
  initialRegion,
  region,
  campusData,        // ← Web-only direct data prop
  // native-only props we accept but ignore on web:
  provider,
  mapType,
  showsUserLocation,
  showsMyLocationButton,
  onRegionChange,
}) {
  // ── Collect dynamic overlay elements from children ────────────────────────
  const { overlayMarkers, overlayPolylines } = useMemo(() => {
    const flat = flattenChildren(children);
    return {
      overlayMarkers:   flat.filter(isMarker),
      overlayPolylines: flat.filter(isPolyline),
    };
  }, [children]);

  // ── Static data from campusData prop ──────────────────────────────────────
  const buildings  = campusData?.buildings  ?? [];
  const paths      = campusData?.paths      ?? [];
  const locations  = campusData?.locations  ?? [];

  // ── Compute map bounds from ALL data ─────────────────────────────────────
  const mapBounds = useMemo(() => {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    let count = 0;

    const addPt = (lat, lng) => {
      if (!isFinite(lat) || !isFinite(lng)) return;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      count++;
    };

    // Static campus geometry
    for (const b of buildings) for (const [lat, lng] of (b.points ?? [])) addPt(lat, lng);
    for (const p of paths)     for (const [lat, lng] of (p.points ?? [])) addPt(lat, lng);
    for (const l of locations) addPt(l.lat, l.lng);

    // Dynamic overlay points
    for (const m of overlayMarkers) {
      addPt(m.props?.coordinate?.latitude, m.props?.coordinate?.longitude);
    }
    for (const p of overlayPolylines) {
      for (const pt of (p.props?.coordinates ?? [])) {
        addPt(pt.latitude ?? pt[0], pt.longitude ?? pt[1]);
      }
    }

    if (count > 0 && isFinite(minLat)) {
      const latPad = (maxLat - minLat) * 0.06 || 0.003;
      const lngPad = (maxLng - minLng) * 0.06 || 0.003;
      return { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad };
    }

    // Fallback to region prop
    const cLat = region?.latitude ?? initialRegion?.latitude ?? 9.2868;
    const cLng = region?.longitude ?? initialRegion?.longitude ?? 7.4114;
    const d    = region?.latitudeDelta ?? initialRegion?.latitudeDelta ?? 0.012;
    return { minLat: cLat - d / 2, maxLat: cLat + d / 2, minLng: cLng - d / 2, maxLng: cLng + d / 2 };
  }, [buildings, paths, locations, overlayMarkers, overlayPolylines, region, initialRegion]);

  // ── Pan & Zoom state ──────────────────────────────────────────────────────
  const [zoom, setZoom]         = useState(1);
  const [pan,  setPan]          = useState({ x: 0, y: 0 });
  const [isDragging, setDrag]   = useState(false);
  const dragStart                = useRef({ x: 0, y: 0 });
  const containerRef             = useRef(null);

  // ── Coordinate projection ─────────────────────────────────────────────────
  const project = useCallback((lat, lng) => {
    const latSpan = mapBounds.maxLat - mapBounds.minLat || 0.001;
    const lngSpan = mapBounds.maxLng - mapBounds.minLng || 0.001;
    const svgX = ((lng - mapBounds.minLng) / lngSpan) * 1000;
    const svgY = ((mapBounds.maxLat - lat)  / latSpan) * 1000;
    return {
      svgX,
      svgY,
      cssX: `${((svgX / 1000) * 100).toFixed(3)}%`,
      cssY: `${((svgY / 1000) * 100).toFixed(3)}%`,
    };
  }, [mapBounds]);

  const toSvgPoints = useCallback((coordinates) => {
    if (!coordinates?.length) return "";
    const parts = [];
    for (const pt of coordinates) {
      const lat = pt.latitude ?? pt[0];
      const lng = pt.longitude ?? pt[1];
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const { svgX, svgY } = project(lat, lng);
      parts.push(`${svgX.toFixed(1)},${svgY.toFixed(1)}`);
    }
    return parts.join(" ");
  }, [project]);

  // ── Mouse interaction ────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    setDrag(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const onMouseUp = () => setDrag(false);

  // Passive wheel (no preventDefault warning)
  const onWheel = useCallback((e) => {
    setZoom((z) => e.deltaY < 0 ? Math.min(z * 1.15, 14) : Math.max(z / 1.15, 0.4));
  }, []);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const zoomIn  = () => setZoom((z) => Math.min(z * 1.4, 14));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.4, 0.4));
  const reset   = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── SVG: static buildings (polygons) ────────────────────────────────────
  const buildingSvg = useMemo(() => {
    const shapes = [];
    for (let i = 0; i < buildings.length; i++) {
      const pts = buildings[i].points;
      if (!pts || pts.length < 3) continue;
      const pointsStr = toSvgPoints(pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      if (!pointsStr) continue;
      shapes.push(
        <polygon
          key={`bldg-${i}`}
          points={pointsStr}
          fill="#CBD8ED"
          stroke="#8A9BBD"
          strokeWidth={0.8}
          strokeLinejoin="round"
        />
      );
    }
    return shapes;
  }, [buildings, toSvgPoints]);

  // ── SVG: static paths (roads/walkways) ───────────────────────────────────
  const pathSvg = useMemo(() => {
    return paths.map((path, i) => {
      const pts = path.points;
      if (!pts || pts.length < 2) return null;
      const pointsStr = toSvgPoints(pts.map(([lat, lng]) => ({ latitude: lat, longitude: lng })));
      if (!pointsStr) return null;
      return (
        <polyline
          key={`path-${i}`}
          points={pointsStr}
          fill="none"
          stroke="#8A9BBD"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.7}
        />
      );
    });
  }, [paths, toSvgPoints]);

  // ── SVG: dynamic overlay polylines (walk route, trip dashes) ─────────────
  const overlaySvg = useMemo(() => {
    return overlayPolylines.map((poly, i) => {
      const props = poly.props ?? {};
      const coords = props.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const pointsStr = toSvgPoints(coords);
      if (!pointsStr) return null;
      const strokeColor = props.strokeColor || "#00C48C";
      return (
        <polyline
          key={`overlay-${i}`}
          points={pointsStr}
          fill="none"
          stroke={strokeColor}
          strokeWidth={(props.strokeWidth || 3) + 1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    });
  }, [overlayPolylines, toSvgPoints]);

  // ── HTML: static location markers (scaled down when zoomed) ──────────────
  const locationDots = useMemo(() => {
    return locations.map((loc, i) => {
      if (!isFinite(loc.lat) || !isFinite(loc.lng)) return null;
      const { cssX, cssY } = project(loc.lat, loc.lng);
      return (
        <div
          key={`loc-${i}`}
          title={loc.name}
          style={{
            position:  "absolute",
            left:      cssX,
            top:       cssY,
            transform: "translate(-50%, -50%)",
            width:     8,
            height:    8,
            borderRadius: "50%",
            backgroundColor: "#3B82F6",
            border:    "1.5px solid #fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            zIndex:    10,
            cursor:    "pointer",
            pointerEvents: "auto",
          }}
        />
      );
    });
  }, [locations, project]);

  // ── HTML: dynamic overlay markers (ride / walk / rider) ──────────────────
  const overlayMarkerDivs = useMemo(() => {
    return overlayMarkers.map((m, i) => {
      const props = m.props ?? {};
      const coord = props.coordinate;
      if (!coord || !isFinite(coord.latitude) || !isFinite(coord.longitude)) return null;
      const { cssX, cssY } = project(coord.latitude, coord.longitude);
      return (
        <div
          key={`omark-${i}`}
          onClick={(e) => { e.stopPropagation(); props.onPress?.(); }}
          title={props.title || ""}
          style={{
            position:  "absolute",
            left:      cssX,
            top:       cssY,
            transform: "translate(-50%, -50%)",
            cursor:    "pointer",
            zIndex:    30,
            pointerEvents: "auto",
          }}
        >
          {props.children ? (
            <div style={{ transform: `scale(${1 / Math.sqrt(zoom)})`, transformOrigin: "center" }}>
              {props.children}
            </div>
          ) : (
            <div style={{
              backgroundColor: "#00C48C",
              padding: "3px 7px",
              borderRadius: 10,
              color: "#fff",
              fontSize: 11,
              fontWeight: "bold",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}>
              {props.title || "📍"}
            </div>
          )}
        </div>
      );
    });
  }, [overlayMarkers, project, zoom]);

  // ── Debug badge ───────────────────────────────────────────────────────────
  const debugMsg = `${buildings.length} bldg · ${paths.length} roads · ${locations.length} loc`;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <View style={[styles.root, style]}>

      {/* Zoom controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomIn}>
          <Text style={styles.ctrlText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomOut}>
          <Text style={styles.ctrlText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={reset}>
          <Text style={[styles.ctrlText, { fontSize: 9 }]}>RESET</Text>
        </TouchableOpacity>
      </View>

      {/* Debug badge — always visible so we can confirm data is loaded */}
      <View style={styles.debugBadge}>
        <Text style={styles.debugText}>{debugMsg}</Text>
      </View>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          width:    "100%",
          height:   "100%",
          position: "relative",
          backgroundColor: "#EEF2FA",
          backgroundImage: "radial-gradient(#C5D0E8 1px, transparent 1px)",
          backgroundSize:  "20px 20px",
          overflow: "hidden",
          cursor:   isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Pannable / zoomable layer */}
        <div style={{
          width:    "100%",
          height:   "100%",
          position: "absolute",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          transition: isDragging ? "none" : "transform 0.08s ease-out",
        }}>

          {/* SVG vector layer */}
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, display: "block" }}
          >
            <rect x="0" y="0" width="1000" height="1000" fill="#EEF2FA" />
            {buildingSvg}
            {pathSvg}
            {overlaySvg}
          </svg>

          {/* Marker layer — pointer-events passthrough except on actual markers */}
          <div style={{
            position: "absolute", top: 0, left: 0,
            width: "100%", height: "100%",
            pointerEvents: "none",
          }}>
            {locationDots}
            {overlayMarkerDivs}
          </div>

        </div>
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: "#EEF2FA",
    position:        "relative",
    overflow:        "hidden",
  },
  controls: {
    position: "absolute",
    top:      16,
    right:    16,
    zIndex:   200,
    flexDirection: "column",
    gap: 6,
  },
  ctrlBtn: {
    width:           38,
    height:          38,
    borderRadius:    8,
    backgroundColor: "#FFFFFF",
    borderWidth:     1,
    borderColor:     "#C8D3E8",
    alignItems:      "center",
    justifyContent:  "center",
    shadowColor:     "#000",
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.1,
    shadowRadius:    4,
    elevation:       3,
  },
  ctrlText: {
    color:      "#1E293B",
    fontSize:   18,
    fontWeight: "bold",
  },
  debugBadge: {
    position:        "absolute",
    bottom:          16,
    left:            16,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:    8,
    zIndex:          200,
    borderWidth:     1,
    borderColor:     "#C8D3E8",
  },
  debugText: {
    color:    "#475569",
    fontSize: 11,
    fontWeight: "600",
  },
});
