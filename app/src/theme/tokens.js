/**
 * src/theme/tokens.js
 *
 * Single source of truth for the NavCamp design system.
 * Import { C, T, R, S } in any screen or component.
 *
 * C = colours
 * T = typography sizes
 * R = radius
 * S = spacing
 */

// ─── COLOURS ─────────────────────────────────────────────────────────────────
export const C = {
  brand:       "#1E7B4C",   // primary buttons, active tab, links
  brandSoft:   "#E6F2EB",   // selected chips, tinted backgrounds
  bg:          "#F7F8FA",   // page background
  surface:     "#FFFFFF",   // cards
  surface2:    "#F1F3F5",   // inputs, tiles
  text:        "#14171A",   // primary text
  text2:       "#5B6470",   // secondary text
  text3:       "#6B7480",   // placeholders, captions (4.7:1 on white)
  border:      "#E3E7EB",   // hairlines
  danger:      "#C23B3B",   // log out, errors
  info:        "#2F6FD0",   // "my location" dot

  // Aliases used in existing code — map to brand tokens so nothing breaks
  green:       "#1E7B4C",
  sub:         "#5B6470",
  red:         "#C23B3B",
};

// ─── TYPOGRAPHY ───────────────────────────────────────────────────────────────
export const T = {
  pageTitle:     { fontSize: 22, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sectionTitle:  { fontSize: 16, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  body:          { fontSize: 14, fontWeight: "400", fontFamily: "Inter_400Regular"  },
  secondary:     { fontSize: 13, fontWeight: "400", fontFamily: "Inter_400Regular"  },
  caption:       { fontSize: 12, fontWeight: "400", fontFamily: "Inter_400Regular"  },
  label:         { fontSize: 13, fontWeight: "500", fontFamily: "Inter_500Medium"   },
};

// ─── RADIUS ───────────────────────────────────────────────────────────────────
export const R = {
  card:    12,
  input:   12,
  search:  14,
  chip:    999,
  button:  12,
};

// ─── SPACING (4px scale) ──────────────────────────────────────────────────────
export const S = {
  xs:  4,
  sm:  8,
  md:  12,
  base:16,
  lg:  20,
  xl:  24,
};

// ─── TAP TARGET ───────────────────────────────────────────────────────────────
export const MIN_TAP = 44;
