import React from "react";
import { View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation";
import GlobalToast from "./src/screens/shared/GlobalToast";
import useAppFonts from "./src/theme/useAppFonts";
import { C } from "./src/theme/tokens";

export default function App() {
  const fontsLoaded = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
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
