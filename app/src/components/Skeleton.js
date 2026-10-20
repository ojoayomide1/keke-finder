/**
 * src/components/Skeleton.js
 *
 * Animated skeleton placeholder for loading states.
 * Replaces blank screens and spinners over empty content.
 *
 * Usage:
 *   <Skeleton width={200} height={16} />
 *   <Skeleton width="100%" height={80} radius={12} />
 *   <SkeletonCard />         — standard card placeholder
 *   <SkeletonRow />          — standard list row placeholder
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

const SHIMMER_COLOR  = "#E8EBF0";
const HIGHLIGHT_COLOR = "#F5F6F8";

export default function Skeleton({ width = "100%", height = 16, radius = 6, style }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const bg = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: [SHIMMER_COLOR, HIGHLIGHT_COLOR],
  });

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: bg },
        style,
      ]}
    />
  );
}

// ─── PRESET SKELETONS ─────────────────────────────────────────────────────────

/** A card-shaped skeleton block */
export function SkeletonCard({ style }) {
  return (
    <View style={[styles.card, style]}>
      <Skeleton width="60%" height={14} style={{ marginBottom: 12 }} />
      <Skeleton width="100%" height={10} style={{ marginBottom: 8 }} />
      <Skeleton width="85%" height={10} style={{ marginBottom: 8 }} />
      <Skeleton width="70%" height={10} />
    </View>
  );
}

/** A list row skeleton */
export function SkeletonRow({ style }) {
  return (
    <View style={[styles.row, style]}>
      <Skeleton width={36} height={36} radius={9} style={{ flexShrink: 0 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="35%" height={11} />
      </View>
    </View>
  );
}

/** Stats grid skeleton (2 tiles) */
export function SkeletonStats() {
  return (
    <View style={styles.statsRow}>
      <View style={styles.statTile}>
        <Skeleton width="50%" height={24} style={{ marginBottom: 6 }} />
        <Skeleton width="70%" height={11} />
      </View>
      <View style={styles.statTile}>
        <Skeleton width="50%" height={24} style={{ marginBottom: 6 }} />
        <Skeleton width="70%" height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#E3E7EB",
    padding:         16,
    marginBottom:    16,
  },
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            12,
    backgroundColor:"#FFFFFF",
    borderRadius:   12,
    borderWidth:    1,
    borderColor:    "#E3E7EB",
    padding:        14,
    marginBottom:   10,
  },
  statsRow: {
    flexDirection: "row",
    gap:           12,
    marginBottom:  16,
  },
  statTile: {
    flex:            1,
    backgroundColor: "#FFFFFF",
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     "#E3E7EB",
    padding:         16,
    alignItems:      "flex-start",
  },
});
