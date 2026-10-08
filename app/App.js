import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation";
import GlobalToast from "./src/screens/shared/GlobalToast";

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <RootNavigator />
      <GlobalToast />
    </>
  );
}
