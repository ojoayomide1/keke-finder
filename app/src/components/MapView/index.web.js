/**
 * index.web.js — Web-only MapView replacement for react-native-maps.
 *
 * Marker and Polyline are real React components (render null) so they pass
 * React.Children validation. MapView detects them via displayName and reads
 * their data from props.
 *
 * ROOT-CAUSE FIX: Previous version returned plain JS objects from Marker/Polyline,
 * which are not valid React elements — React.Children.toArray() silently dropped
 * them, so MapView received zero children to render.
 */

import React, {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

// ─── Re-exported constants (match react-native-maps API) ─────────────────────

export const PROVIDER_DEFAULT = "default";
export const PROVIDER_GOOGLE = "google";

// ─── Marker ──────────────────────────────────────────────────────────────────
// A real React component that renders nothing. MapView reads its props directly.

export function Marker({ coordinate, title, description, onPress, children }) {
  // Renders nothing — MapView reads this element's props from the React tree.
  return null;
}
Marker.displayName = "MapViewMarker";

// ─── Polyline ─────────────────────────────────────────────────────────────────
// Same pattern.

export function Polyline({
  coordinates,
  strokeColor = "#64748B",
  strokeWidth = 3,
  lineDashPattern,
  opacity,
}) {
  return null;
}
Polyline.displayName = "MapViewPolyline";

// ─── Helper: detect component type safely (survives minification) ────────────

function isMarker(element) {
  if (!element || !element.type) return false;
  const dn = element.type.displayName;
  if (dn === "MapViewMarker") return true;
  // Fallback: name check (may not survive minification but helps in dev)
  if (typeof element.type === "function" && element.type.name === "Marker") return true;
  return false;
}

function isPolyline(element) {
  if (!element || !element.type) return false;
  const dn = element.type.displayName;
  if (dn === "MapViewPolyline") return true;
  if (typeof element.type === "function" && element.type.name === "Polyline") return true;
  return false;
}

// ─── Main MapView ─────────────────────────────────────────────────────────────

export default function MapView({
  style,
  children,
  initialRegion,
  region,
  // The following props are accepted but ignored on web (native-only)
  provider,
  mapType,
  showsUserLocation,
  showsMyLocationButton,
  onRegionChange,
}) {
  // ── Collect Marker and Polyline elements from the React children tree ──────
  const { markers, polylines } = useMemo(() => {
    const allChildren = [];

    function collect(nodes) {
      React.Children.forEach(nodes, (child) => {
        if (!child) return;
        allChildren.push(child);
        // Also recurse into fragments / arrays
        if (child.props && child.props.children) {
          collect(child.props.children);
        }
      });
    }

    collect(children);

    const markers = allChildren.filter(isMarker);
    const polylines = allChildren.filter(isPolyline);
    return { markers, polylines };
  }, [children]);

  // ── Compute tight map bounds from all lat/lng data ────────────────────────
  const mapBounds = useMemo(() => {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity,
      count = 0;

    // From markers
    for (const m of markers) {
      const lat = m.props?.coordinate?.latitude;
      const lng = m.props?.coordinate?.longitude;
      if (lat != null && lng != null && isFinite(lat) && isFinite(lng)) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        count++;
      }
    }

    // From polylines
    for (const p of polylines) {
      const coords = p.props?.coordinates;
      if (!Array.isArray(coords)) continue;
      for (const pt of coords) {
        const lat = pt.latitude != null ? pt.latitude : pt[0];
        const lng = pt.longitude != null ? pt.longitude : pt[1];
        if (lat != null && lng != null && isFinite(lat) && isFinite(lng)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          count++;
        }
      }
    }

    if (count > 0 && isFinite(minLat)) {
      const latPad = (maxLat - minLat) * 0.08 || 0.002;
      const lngPad = (maxLng - minLng) * 0.08 || 0.002;
      return {
        minLat: minLat - latPad,
        maxLat: maxLat + latPad,
        minLng: minLng - lngPad,
        maxLng: maxLng + lngPad,
      };
    }

    // Fallback to initial/region prop
    const cLat =
      (region && region.latitude) ||
      (initialRegion && initialRegion.latitude) ||
      9.2868;
    const cLng =
      (region && region.longitude) ||
      (initialRegion && initialRegion.longitude) ||
      7.4114;
    const dLat =
      (region && region.latitudeDelta) ||
      (initialRegion && initialRegion.latitudeDelta) ||
      0.012;
    return {
      minLat: cLat - dLat / 2,
      maxLat: cLat + dLat / 2,
      minLng: cLng - dLat / 2,
      maxLng: cLng + dLat / 2,
    };
  }, [markers, polylines, region, initialRegion]);

  // ── Pan & Zoom state ──────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // ── Project (lat,lng) → SVG viewport coords 0..1000 ──────────────────────
  const projectPoint = useCallback(
    (lat, lng) => {
      const latSpan = mapBounds.maxLat - mapBounds.minLat || 0.001;
      const lngSpan = mapBounds.maxLng - mapBounds.minLng || 0.001;
      const svgX = ((lng - mapBounds.minLng) / lngSpan) * 1000;
      const svgY = ((mapBounds.maxLat - lat) / latSpan) * 1000;
      return {
        x: `${((svgX / 1000) * 100).toFixed(3)}%`,
        y: `${((svgY / 1000) * 100).toFixed(3)}%`,
        svgX,
        svgY,
      };
    },
    [mapBounds]
  );

  // ── Build SVG points string for a coordinate array ────────────────────────
  const getSvgPoints = useCallback(
    (coordinates) => {
      if (!coordinates || coordinates.length === 0) return "";
      const parts = [];
      for (const pt of coordinates) {
        const lat = pt.latitude != null ? pt.latitude : pt[0];
        const lng = pt.longitude != null ? pt.longitude : pt[1];
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const { svgX, svgY } = projectPoint(lat, lng);
        parts.push(`${svgX.toFixed(1)},${svgY.toFixed(1)}`);
      }
      return parts.join(" ");
    },
    [projectPoint]
  );

  // ── Mouse pan handlers ────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const handleMouseUp = () => setIsDragging(false);

  // ── Passive wheel zoom (no preventDefault — avoids browser warning) ───────
  const handleWheel = useCallback((e) => {
    // Do NOT call e.preventDefault() — wheel listeners are passive in modern browsers
    setZoom((z) => e.deltaY < 0 ? Math.min(z * 1.15, 12) : Math.max(z / 1.15, 0.5));
  }, []);

  // Attach wheel listener manually so we can pass { passive: true }
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: true });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const zoomIn = () => setZoom((z) => Math.min(z * 1.3, 12));
  const zoomOut = () => setZoom((z) => Math.max(z / 1.3, 0.5));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── Memoised SVG paths ────────────────────────────────────────────────────
  const renderedSvgPaths = useMemo(() => {
    const svgs = [];

    for (let idx = 0; idx < polylines.length; idx++) {
      const poly = polylines[idx];
      const props = poly.props || {};
      const coords = props.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;

      const pointsStr = getSvgPoints(coords);
      if (!pointsStr) continue;

      const strokeColor = props.strokeColor || "#475569";
      const strokeWidth = props.strokeWidth || 3;
      const isHighlight =
        strokeColor === "#00C48C" ||
        strokeColor === "#FF5E1A" ||
        strokeColor === "rgba(0,196,140,0.5)";

      // Heuristic: if first and last coords are the same or coords.length > 4 with
      // a repeated point, treat as polygon (building footprint)
      const firstPt = coords[0];
      const lastPt = coords[coords.length - 1];
      const firstLat = firstPt?.latitude ?? firstPt?.[0];
      const firstLng = firstPt?.longitude ?? firstPt?.[1];
      const lastLat = lastPt?.latitude ?? lastPt?.[0];
      const lastLng = lastPt?.longitude ?? lastPt?.[1];
      const isPolygon =
        coords.length >= 4 &&
        Math.abs(firstLat - lastLat) < 0.00001 &&
        Math.abs(firstLng - lastLng) < 0.00001;

      if (isPolygon) {
        svgs.push(
          <polygon
            key={`p-${idx}`}
            points={pointsStr}
            fill="#DDE3ED"
            stroke="#8A9BBD"
            strokeWidth={1}
            strokeLinejoin="round"
            opacity={0.9}
          />
        );
      } else {
        svgs.push(
          <polyline
            key={`l-${idx}`}
            points={pointsStr}
            fill="none"
            stroke={isHighlight ? strokeColor : "#6B7A99"}
            strokeWidth={isHighlight ? strokeWidth + 2 : Math.max(strokeWidth * 0.8, 1.5)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isHighlight ? 1 : 0.75}
          />
        );
      }
    }

    return svgs;
  }, [polylines, getSvgPoints]);

  // ── Memoised HTML marker layer ────────────────────────────────────────────
  const renderedMarkers = useMemo(() => {
    return markers.map((m, idx) => {
      const props = m.props || {};
      const coord = props.coordinate;
      if (!coord || coord.latitude == null || coord.longitude == null) return null;
      if (!isFinite(coord.latitude) || !isFinite(coord.longitude)) return null;

      const { x, y } = projectPoint(coord.latitude, coord.longitude);

      return (
        <div
          key={`marker-${idx}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onPress?.();
          }}
          style={{
            position: "absolute",
            left: x,
            top: y,
            transform: "translate(-50%, -50%)",
            cursor: "pointer",
            zIndex: 20,
            pointerEvents: "auto",
          }}
          title={props.title || ""}
        >
          {/* If <Marker> has children (e.g. custom bubble), render them */}
          {props.children ? (
            <div style={{ transform: `scale(${1 / Math.sqrt(zoom)})`, transformOrigin: "center center" }}>
              {props.children}
            </div>
          ) : (
            <div
              style={{
                backgroundColor: "#00C48C",
                padding: "3px 7px",
                borderRadius: "10px",
                color: "#FFFFFF",
                fontSize: "11px",
                fontWeight: "bold",
                boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                border: "1.5px solid rgba(255,255,255,0.6)",
                whiteSpace: "nowrap",
                transform: `scale(${1 / Math.sqrt(zoom)})`,
                transformOrigin: "center center",
              }}
            >
              {props.title || "📍"}
            </div>
          )}
        </div>
      );
    });
  }, [markers, projectPoint, zoom]);

  // ─── RENDER ──────────────────────────────────────────────────────────────

  const dataCount = markers.length + polylines.length;

  return (
    <View style={[styles.root, style]}>
      {/* Zoom Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomIn}>
          <Text style={styles.ctrlText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomOut}>
          <Text style={styles.ctrlText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={resetView}>
          <Text style={[styles.ctrlText, { fontSize: 9 }]}>RESET</Text>
        </TouchableOpacity>
      </View>

      {/* Data count badge (debug, shown while loading) */}
      {dataCount === 0 && (
        <View style={styles.loadingBadge}>
          <Text style={styles.loadingText}>Loading campus map…</Text>
        </View>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          backgroundColor: "#F0F4FA",
          backgroundImage:
            "radial-gradient(#C8D3E8 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          overflow: "hidden",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        // No onWheel here — attached via addEventListener with passive:true
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.08s ease-out",
          }}
        >
          {/* SVG vector layer — buildings and paths */}
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: "100%",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            {/* Light map background */}
            <rect x="0" y="0" width="1000" height="1000" fill="#F0F4FA" />
            {renderedSvgPaths}
          </svg>

          {/* HTML marker layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          >
            {renderedMarkers}
          </div>
        </div>
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F0F4FA",
    position: "relative",
    overflow: "hidden",
  },
  controls: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 200,
    flexDirection: "column",
    gap: 6,
  },
  ctrlBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#C8D3E8",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  ctrlText: {
    color: "#1E293B",
    fontSize: 18,
    fontWeight: "bold",
  },
  loadingBadge: {
    position: "absolute",
    bottom: 16,
    left: 16,
    backgroundColor: "rgba(255,255,255,0.9)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    zIndex: 200,
  },
  loadingText: {
    color: "#475569",
    fontSize: 12,
  },
});
