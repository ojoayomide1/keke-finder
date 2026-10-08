import React, { useState, useRef, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

export const PROVIDER_DEFAULT = "default";

/**
 * Marker component for Web Map
 */
export function Marker({ coordinate, title, description, onPress, children }) {
  return {
    type: "Marker",
    props: { coordinate, title, description, onPress, children }
  };
}

/**
 * Polyline component for Web Map
 */
export function Polyline({ coordinates, strokeColor = "#64748B", strokeWidth = 3 }) {
  return {
    type: "Polyline",
    props: { coordinates, strokeColor, strokeWidth }
  };
}

/**
 * Interactive Web MapView component.
 * Renders campus features (buildings, roads, locations) on a crisp light canvas (#F4F6F9)
 * with mouse panning, scroll zooming, marker popups, and auto-bounds fitting.
 */
export default function MapView({ style, children, initialRegion, region }) {
  const containerRef = useRef(null);

  // Extract markers & polylines from React children
  const childrenArray = React.Children.toArray(children).flatMap(c => {
    if (!c) return [];
    if (Array.isArray(c)) return c;
    return [c];
  });

  const polylines = childrenArray.filter(c => c && (c.type === Polyline || c.type?.name === "Polyline" || c.props?.coordinates));
  const markers = childrenArray.filter(c => c && (c.type === Marker || c.type?.name === "Marker" || c.props?.coordinate));

  // Collect all coordinates to compute auto-bounds if region is default
  const allCoords = useMemo(() => {
    const list = [];
    markers.forEach(m => {
      if (m.props?.coordinate?.latitude && m.props?.coordinate?.longitude) {
        list.push([m.props.coordinate.latitude, m.props.coordinate.longitude]);
      }
    });
    polylines.forEach(p => {
      (p.props?.coordinates || []).forEach(pt => {
        const lat = pt.latitude != null ? pt.latitude : pt[0];
        const lng = pt.longitude != null ? pt.longitude : pt[1];
        if (lat && lng) list.push([lat, lng]);
      });
    });
    return list;
  }, [markers, polylines]);

  // Compute map bounds
  const mapBounds = useMemo(() => {
    if (allCoords.length > 0) {
      const lats = allCoords.map(c => c[0]);
      const lngs = allCoords.map(c => c[1]);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);

      // Add 10% padding around campus features
      const latPad = (maxLat - minLat) * 0.1 || 0.002;
      const lngPad = (maxLng - minLng) * 0.1 || 0.002;
      return {
        minLat: minLat - latPad,
        maxLat: maxLat + latPad,
        minLng: minLng - lngPad,
        maxLng: maxLng + lngPad,
      };
    }

    const cLat = (region && region.latitude) || (initialRegion && initialRegion.latitude) || 9.2868;
    const cLng = (region && region.longitude) || (initialRegion && initialRegion.longitude) || 7.4114;
    const dLat = (region && region.latitudeDelta) || (initialRegion && initialRegion.latitudeDelta) || 0.008;

    return {
      minLat: cLat - dLat / 2,
      maxLat: cLat + dLat / 2,
      minLng: cLng - dLat / 2,
      maxLng: cLng + dLat / 2,
    };
  }, [allCoords, region, initialRegion]);

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Map coordinate (lat, lng) to percentage inside viewBox 0..1000 x 0..1000
  const projectPoint = useCallback((lat, lng) => {
    const latSpan = mapBounds.maxLat - mapBounds.minLat || 0.001;
    const lngSpan = mapBounds.maxLng - mapBounds.minLng || 0.001;
    const x = ((lng - mapBounds.minLng) / lngSpan) * 1000;
    const y = ((mapBounds.maxLat - lat) / latSpan) * 1000;
    return { x: `${(x / 10).toFixed(2)}%`, y: `${(y / 10).toFixed(2)}%`, svgX: x, svgY: y };
  }, [mapBounds]);

  // Convert polyline coordinates array into SVG points string
  const getSvgPoints = (coordinates) => {
    if (!coordinates || coordinates.length === 0) return "";
    return coordinates
      .map(pt => {
        const lat = pt.latitude != null ? pt.latitude : pt[0];
        const lng = pt.longitude != null ? pt.longitude : pt[1];
        const { svgX, svgY } = projectPoint(lat, lng);
        return `${svgX.toFixed(1)},${svgY.toFixed(1)}`;
      })
      .join(" ");
  };

  // Mouse pan handlers
  const handleMouseDown = (e) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Mouse wheel zoom
  const handleWheel = (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setZoom(z => Math.min(z * 1.2, 8));
    } else {
      setZoom(z => Math.max(z / 1.2, 0.6));
    }
  };

  // Zoom controls
  const zoomIn = () => setZoom(z => Math.min(z * 1.3, 8));
  const zoomOut = () => setZoom(z => Math.max(z / 1.3, 0.6));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <View style={[styles.root, style]}>
      {/* Zoom Control Buttons */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomIn}>
          <Text style={styles.ctrlText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomOut}>
          <Text style={styles.ctrlText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={resetView}>
          <Text style={[styles.ctrlText, { fontSize: 10, fontWeight: "800" }]}>RESET</Text>
        </TouchableOpacity>
      </View>

      {/* Main Map Container (Whitish / Light Slate Theme) */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          backgroundColor: "#F1F5F9",
          backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          overflow: "hidden",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          {/* SVG Vector Layer for Buildings, Roads & Walkways */}
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
          >
            {polylines.map((poly, idx) => {
              const props = poly.props || {};
              const coords = props.coordinates || [];
              const pointsStr = getSvgPoints(coords);
              if (!pointsStr) return null;

              // Distinguish building polygons vs paths
              const isClosedPolygon = coords.length > 3 &&
                coords[0]?.latitude === coords[coords.length - 1]?.latitude &&
                coords[0]?.longitude === coords[coords.length - 1]?.longitude;

              if (isClosedPolygon) {
                return (
                  <polygon
                    key={`bldg-poly-${idx}`}
                    points={pointsStr}
                    fill="#E2E8F0"
                    stroke="#94A3B8"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                );
              }

              // Path / Road stroke style
              const stroke = props.strokeColor || "#475569";
              const isHighlight = stroke === "#00C48C" || stroke === "#FF5E1A";
              return (
                <polyline
                  key={`road-poly-${idx}`}
                  points={pointsStr}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHighlight ? 6 : 4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={isHighlight ? 1 : 0.75}
                />
              );
            })}
          </svg>

          {/* HTML Layer for Map Markers */}
          {markers.map((m, idx) => {
            const props = m.props || {};
            const coord = props.coordinate;
            if (!coord || coord.latitude == null || coord.longitude == null) return null;

            const { x, y } = projectPoint(coord.latitude, coord.longitude);
            return (
              <div
                key={`web-marker-${idx}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onPress?.();
                }}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  transform: `scale(${1 / Math.sqrt(zoom)}) translate(-50%, -50%)`,
                  transformOrigin: "top left",
                  cursor: "pointer",
                  zIndex: 20,
                }}
                title={props.title || ""}
              >
                {props.children || (
                  <div style={{
                    backgroundColor: "#00C48C",
                    padding: "4px 8px",
                    borderRadius: "12px",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    fontWeight: "bold",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    border: "1px solid #ffffff",
                    whiteSpace: "nowrap",
                  }}>
                    {props.title || "📍"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F1F5F9",
    position: "relative",
    overflow: "hidden",
  },
  controls: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 100,
    flexDirection: "column",
    gap: 6,
  },
  ctrlBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
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
});
