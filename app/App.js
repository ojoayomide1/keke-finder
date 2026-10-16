import React from "react";
import { Platform, View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation";
import GlobalToast from "./src/screens/shared/GlobalToast";
import useAppFonts from "./src/theme/useAppFonts";
import { C } from "./src/theme/tokens";

export default function App() {
  const fontsLoaded = useAppFonts();

  // On web, Google Fonts CSS handles Inter — no need to block render.
  // On native, wait for expo-font to finish so there's no FOUT.
  const ready = Platform.OS === "web" || fontsLoaded;

  if (!ready) {
    return (
      <View style={{
        flex: 1,
        width: "100%",
        height: "100%",
        backgroundColor: C.bg,
        alignItems: "center",
        justifyContent: "center",
      }}>
        <ActivityIndicator color={C.brand} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" backgroundColor={C.bg} />
      <RootNavigator />
      <GlobalToast />
    </>
  );
}
