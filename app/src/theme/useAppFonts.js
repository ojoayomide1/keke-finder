/**
 * src/theme/useAppFonts.js
 *
 * Loads Inter (400, 500, 600) via expo-font.
 * On web, Inter is loaded from Google Fonts via index.html / app shell.
 * On native, expo-font downloads the bundled font files.
 *
 * Usage:
 *   const fontsLoaded = useAppFonts();
 *   if (!fontsLoaded) return null;
 */

import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";

export default function useAppFonts() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  return loaded;
}
