/**
 * src/components/Icon.js
 *
 * Platform-safe icon component.
 * - Native: lucide-react-native (SVG-based, requires react-native-svg)
 * - Web: simple text span with Unicode symbol fallback
 *
 * This avoids react-native-svg web transformer issues during Expo web builds.
 * When the SVG web pipeline is properly configured, remove the web fallback.
 */

import React from "react";
import { Platform, Text } from "react-native";

// ─── WEB FALLBACK MAP (Unicode symbols) ──────────────────────────────────────
const WEB_SYMBOLS = {
  "car":           "🚗",
  "compass":       "🧭",
  "wallet":        "💳",
  "user":          "👤",
  "map-pin":       "📍",
  "search":        "🔍",
  "sparkles":      "✨",
  "footprints":    "👣",
  "stairs":        "🪜",
  "door-open":     "🚪",
  "receipt":       "🧾",
  "life-buoy":     "🛟",
  "chevron-right": "›",
  "chevron-left":  "‹",
  "x":             "✕",
  "check":         "✓",
  "star":          "☆",
  "clock":         "🕐",
  "navigation":    "➤",
  "arrow-left":    "←",
  "send":          "➤",
  "mic":           "🎤",
  "map":           "🗺",
  "home":          "🏠",
  "banknote":      "💵",
  "trending-up":   "📈",
  "circle-alert":  "⚠",
  "info":          "ℹ",
  "building":      "🏢",
  "graduation-cap":"🎓",
  "utensils":      "🍽",
  "bed":           "🛏",
  "flask":         "🔬",
  "dumbbell":      "🏋",
  "log-out":       "⎋",
  "phone":         "📞",
  "mail":          "✉",
  "refresh":       "↻",
};

// ─── NATIVE LUCIDE MAP ────────────────────────────────────────────────────────
// Lazy-loaded only on native to avoid crashing the web bundle
let _lucideIcons = null;
function getLucideIcon(name) {
  if (!_lucideIcons) {
    try {
      const lib = require("lucide-react-native");
      _lucideIcons = {
        "car":           lib.Car,
        "compass":       lib.Compass,
        "wallet":        lib.Wallet,
        "user":          lib.User,
        "map-pin":       lib.MapPin,
        "search":        lib.Search,
        "sparkles":      lib.Sparkles,
        "footprints":    lib.Footprints,
        "stairs":        lib.Stairs,
        "door-open":     lib.DoorOpen,
        "receipt":       lib.Receipt,
        "life-buoy":     lib.LifeBuoy,
        "chevron-right": lib.ChevronRight,
        "chevron-left":  lib.ChevronLeft,
        "x":             lib.X,
        "check":         lib.Check,
        "star":          lib.Star,
        "clock":         lib.Clock,
        "navigation":    lib.Navigation,
        "arrow-left":    lib.ArrowLeft,
        "send":          lib.Send,
        "mic":           lib.Mic,
        "map":           lib.Map,
        "home":          lib.Home,
        "banknote":      lib.Banknote,
        "trending-up":   lib.TrendingUp,
        "circle-alert":  lib.CircleAlert,
        "info":          lib.Info,
        "building":      lib.Building2,
        "graduation-cap":lib.GraduationCap,
        "utensils":      lib.Utensils,
        "bed":           lib.BedDouble,
        "flask":         lib.FlaskConical,
        "dumbbell":      lib.Dumbbell,
        "log-out":       lib.LogOut,
        "phone":         lib.Phone,
        "mail":          lib.Mail,
        "refresh":       lib.RefreshCw,
      };
    } catch {
      _lucideIcons = {};
    }
  }
  return _lucideIcons[name] ?? null;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function Icon({ name, size = 20, color = "#14171A", strokeWidth = 1.75 }) {
  if (Platform.OS === "web") {
    const symbol = WEB_SYMBOLS[name] ?? "•";
    return (
      <Text
        style={{ fontSize: size * 0.85, color, lineHeight: size, textAlign: "center" }}
        aria-label={name}
      >
        {symbol}
      </Text>
    );
  }

  // Native — use Lucide SVG icons
  const LucideIcon = getLucideIcon(name);
  if (!LucideIcon) {
    if (__DEV__) console.warn(`[Icon] Unknown icon: "${name}"`);
    return null;
  }
  return <LucideIcon size={size} color={color} strokeWidth={strokeWidth} />;
}
