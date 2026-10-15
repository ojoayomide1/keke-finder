/**
 * IndoorPlaceCard.js
 *
 * Reusable result card for an indoor place record.
 * Used by IndoorScreen and (future) AI chat.
 *
 * Props:
 *   place    {PlaceRecord}  — normalized place record from indoor-data.js
 *   onGo     {Function}     — called with the place when Go is tapped
 *   compact  {boolean}      — optional, renders a tighter card (for chat use)
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

// ─── COLOURS (matches app theme) ─────────────────────────────────────────────
const C = {
  bg:      "#F7F8FA",
  surface: "#FFFFFF",
  border:  "#E2E6ED",
  green:   "#1E7A46",
  text:    "#0F1117",
  sub:     "#6B7280",
  blue:    "#2563EB",
  purple:  "#7C3AED",
  orange:  "#EA580C",
};

// ─── TYPE META ────────────────────────────────────────────────────────────────
const TYPE_META = {
  office:       { icon: "🏢", color: C.blue   },
  lecture_hall: { icon: "📖", color: C.purple  },
  lab:          { icon: "🔬", color: C.orange  },
  restroom:     { icon: "🚻", color: C.sub     },
  default:      { icon: "📍", color: C.green   },
};

function getTypeMeta(type) {
  return TYPE_META[type] ?? TYPE_META.default;
}

/**
 * Build a subtitle string: "Building · Floor · Room"
 * Only includes parts that exist.
 */
function buildSubtitle(place) {
  const parts = [];
  if (place.buildingName) parts.push(place.buildingName);
  if (place.floorLabel)   parts.push(place.floorLabel);
  if (place.room && place.room !== place.name) parts.push(place.room);
  return parts.join(" · ");
}

/**
 * Secondary line: occupant title or course list or department.
 */
function buildSecondLine(place) {
  if (place.occupant && place.title) return `${place.title}`;
  if (place.occupant)                return place.occupant;
  if (place.courses.length > 0)      return place.courses.slice(0, 2).join(", ");
  if (place.department)              return place.department;
  return null;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

const IndoorPlaceCard = React.memo(function IndoorPlaceCard({ place, onGo, compact = false }) {
  const meta       = getTypeMeta(place.type);
  const subtitle   = buildSubtitle(place);
  const secondLine = buildSecondLine(place);

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {/* Icon */}
      <View style={[styles.iconWrap, { backgroundColor: meta.color + "18" }]}>
        <Text style={styles.icon}>{meta.icon}</Text>
      </View>

      {/* Text */}
      <View style={styles.textWrap}>
        <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
        {secondLine ? (
          <Text style={styles.secondLine} numberOfLines={1}>{secondLine}</Text>
        ) : null}
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>

      {/* Go button */}
      <TouchableOpacity
        style={styles.goBtn}
        onPress={() => onGo(place)}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.goBtnText}>Go</Text>
      </TouchableOpacity>
    </View>
  );
});

export default IndoorPlaceCard;

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    flexDirection:  "row",
    alignItems:     "center",
    backgroundColor: C.surface,
    borderRadius:   12,
    padding:        14,
    marginBottom:   10,
    borderWidth:    1,
    borderColor:    C.border,
    gap:            12,
  },
  cardCompact: {
    padding:      10,
    marginBottom:  6,
    borderRadius:  8,
  },
  iconWrap: {
    width:          40,
    height:         40,
    borderRadius:   10,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
  icon: {
    fontSize: 20,
  },
  textWrap: {
    flex: 1,
    gap:   2,
  },
  name: {
    color:      C.text,
    fontSize:   15,
    fontWeight: "600",
  },
  secondLine: {
    color:    C.sub,
    fontSize: 12,
  },
  subtitle: {
    color:    C.sub,
    fontSize: 12,
  },
  goBtn: {
    paddingHorizontal: 16,
    paddingVertical:    9,
    borderRadius:       8,
    borderWidth:        1,
    borderColor:        C.green,
    minWidth:          48,
    alignItems:        "center",
  },
  goBtnText: {
    color:      C.green,
    fontWeight: "700",
    fontSize:   14,
  },
});
