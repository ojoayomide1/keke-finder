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
export function Polyline({ coordinates, strokeColor = "#2a2a35", strokeWidth = 3 }) {
  return {
    type: "Polyline",
    props: { coordinates, strokeColor, strokeWidth }
  };
}

/**
 * Web MapView implementation with custom SVG vector rendering,
 * dark theme styling (#0F0F13), mouse panning, and zoom controls.
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

  // Determine center coordinates and zoom scale
  const centerLat = (region && region.latitude) || (initialRegion && initialRegion.latitude) || 9.2868;
  const centerLng = (region && region.longitude) || (initialRegion && initialRegion.longitude) || 7.4114;
  const deltaLat  = (region && region.latitudeDelta) || (initialRegion && initialRegion.latitudeDelta) || 0.008;

  // View state for pan & zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Calculate bounding box for coordinate conversion
  const bounds = useMemo(() => {
    const latRadius = (deltaLat / 2) / zoom;
    const lngRadius = latRadius / zoom;
    return {
      minLat: centerLat - latRadius,
      maxLat: centerLat + latRadius,
      minLng: centerLng - lngRadius,
      maxLng: centerLng + lngRadius,
    };
  }, [centerLat, centerLng, deltaLat, zoom]);

  // Map coordinate (lat, lng) to percentage (x%, y%)
  const projectPoint = useCallback((lat, lng) => {
    const latSpan = bounds.maxLat - bounds.minLat || 0.001;
    const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
    const x = ((lng - bounds.minLng) / lngSpan) * 100;
    const y = ((bounds.maxLat - lat) / latSpan) * 100;
    return { x: `${x}%`, y: `${y}%`, numX: x, numY: y };
  }, [bounds]);

  // Convert polyline coordinates array into SVG points attribute string
  const getSvgPoints = (coordinates) => {
    if (!coordinates || coordinates.length === 0) return "";
    return coordinates
      .map(pt => {
        const lat = pt.latitude != null ? pt.latitude : pt[0];
        const lng = pt.longitude != null ? pt.longitude : pt[1];
        const { numX, numY } = projectPoint(lat, lng);
        return `${numX},${numY}`;
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

  // Zoom controls
  const zoomIn = () => setZoom(prev => Math.min(prev * 1.3, 5));
  const zoomOut = () => setZoom(prev => Math.max(prev / 1.3, 0.5));
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  return (
    <View style={[styles.root, style]}>
      {/* Pan & Zoom Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomIn}>
          <Text style={styles.ctrlText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={zoomOut}>
          <Text style={styles.ctrlText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={resetView}>
          <Text style={[styles.ctrlText, { fontSize: 10 }]}>RESET</Text>
        </TouchableOpacity>
      </View>

      {/* Main Map Viewport */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          backgroundColor: "#0F0F13",
          overflow: "hidden",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transition: isDragging ? "none" : "transform 0.1s ease-out",
          }}
        >
          {/* SVG Layer for Campus Roads, Walkways & Buildings */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
          >
            {polylines.map((poly, idx) => {
              const props = poly.props || {};
              const coords = props.coordinates || [];
              const stroke = props.strokeColor || "#2a2a35";
              const width = (props.strokeWidth || 3) * 0.15;
              const pointsStr = getSvgPoints(coords);
              if (!pointsStr) return null;

              return (
                <polyline
                  key={`svg-poly-${idx}`}
                  points={pointsStr}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>

          {/* HTML Overlay Layer for Markers */}
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
                  transform: "translate(-50%, -50%)",
                  cursor: "pointer",
                  zIndex: 10,
                }}
                title={props.title || ""}
              >
                {props.children || (
                  <div style={{
                    backgroundColor: "#00C48C",
                    padding: "4px 8px",
                    borderRadius: "12px",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "bold",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.5)"
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
    backgroundColor: "#0F0F13",
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
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#1A1A22",
    borderWidth: 1,
    borderColor: "#2a2a35",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "bold",
  },
});
