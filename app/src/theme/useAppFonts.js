/**
 * src/theme/useAppFonts.js
 *
 * Loads Inter (400, 500, 600) via expo-font on native.
 * On web, Google Fonts CSS in public/index.html handles it — returns true immediately.
 */

import { Platform } from "react-native";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";

export default function useAppFonts() {
  // On web, never block — the CSS font is loaded separately
  const [loaded] = useFonts(
    Platform.OS === "web"
      ? {}  // empty object = instant true on web
      : { Inter_400Regular, Inter_500Medium, Inter_600SemiBold }
  );
  return Platform.OS === "web" ? true : loaded;
}
