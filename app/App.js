import React from "react";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation";
import GlobalToast from "./src/screens/shared/GlobalToast";
import useAppFonts from "./src/theme/useAppFonts";
import { C } from "./src/theme/tokens";

export default function App() {
  const fontsLoaded = useAppFonts();

  // Hold render until Inter is ready to avoid FOUT on native.
  // On web this resolves almost immediately since Google Fonts is loaded via CSS.
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.brand} />
      </View>
    );
  }

  return (
    <>
      {/* Force light status bar — the app is light-only */}
      <StatusBar style="dark" backgroundColor={C.bg} />
      <RootNavigator />
      <GlobalToast />
    </>
  );
}
