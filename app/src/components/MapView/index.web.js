import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";

const DEFAULT_REGION = {
  latitude: 9.2882,
  longitude: 7.4116,
  latitudeDelta: 0.006,
  longitudeDelta: 0.006,
};

function getCenterFromCoordinates(coords) {
  if (!coords || coords.length === 0) return null;
  const valid = coords.filter(c => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  if (valid.length === 0) return null;

  const lats = valid.map(c => c.latitude);
  const lngs = valid.map(c => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.004, (maxLat - minLat) * 1.4 || 0.006),
    longitudeDelta: Math.max(0.004, (maxLng - minLng) * 1.4 || 0.006),
  };
}

const MapView = forwardRef(function MapView({ style, children, initialRegion, region }, ref) {
  const [internalRegion, setInternalRegion] = useState(initialRegion || region || DEFAULT_REGION);
  const activeRegion = region || internalRegion || DEFAULT_REGION;

  useImperativeHandle(ref, () => ({
    animateToRegion(nextRegion) {
      if (nextRegion) setInternalRegion(nextRegion);
    },
    fitToCoordinates(coords) {
      const nextRegion = getCenterFromCoordinates(coords);
      if (nextRegion) setInternalRegion(nextRegion);
    },
  }));

  const lat = activeRegion.latitude || DEFAULT_REGION.latitude;
  const lng = activeRegion.longitude || DEFAULT_REGION.longitude;
  const delta = activeRegion.latitudeDelta || activeRegion.longitudeDelta || DEFAULT_REGION.latitudeDelta;

  const minLng = (lng - delta).toFixed(4);
  const minLat = (lat - delta).toFixed(4);
  const maxLng = (lng + delta).toFixed(4);
  const maxLat = (lat + delta).toFixed(4);

  const embedUrl = useMemo(
    () => `https://www.openstreetmap.org/export/embed.html?bbox=${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}&layer=mapnik&marker=${lat}%2C${lng}`,
    [minLng, minLat, maxLng, maxLat, lat, lng]
  );

  return (
    <View style={[styles.container, style]}>
      <iframe
        title="NavCamp Map"
        width="100%"
        height="100%"
        style={styles.iframe}
        src={embedUrl}
      />
      {children}
    </View>
  );
});

export default MapView;

export function Marker() {
  return null;
}

export function Polyline() {
  return null;
}

export const PROVIDER_DEFAULT = "default";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F13",
    overflow: "hidden",
  },
  iframe: {
    border: 0,
    width: "100%",
    height: "100%",
  },
});
