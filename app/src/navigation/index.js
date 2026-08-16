import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ActivityIndicator, Platform, Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, onAuthStateChanged, db, doc, getDoc } from "../config/firebase";
import useStore from "../store";

// ─── SCREENS ─────────────────────────────────────────────────────────────────
import LoginScreen from "../screens/auth/LoginScreen";
import StudentHomeScreen from "../screens/student/HomeScreen";
import WalletScreen from "../screens/student/WalletScreen";
import ProfileScreen from "../screens/student/ProfileScreen";
import PathfinderScreen from "../screens/student/PathfinderScreen";
import RiderHomeScreen from "../screens/rider/HomeScreen";

// ─── NAVIGATORS ──────────────────────────────────────────────────────────────
const AuthStack = createNativeStackNavigator();
const StudentTab = createBottomTabNavigator();
const RiderStack = createNativeStackNavigator();
const RootStack = createNativeStackNavigator();

// Auth flow — shown when no user is signed in
function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

// ─── TAB ICON ────────────────────────────────────────────────────────────────
// Plain emoji icons — no extra icon library needed.
function TabIcon({ label, focused }) {
  const icons = { Home: "🛺", Wallet: "💳", Map: "🗺️", Profile: "👤" };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>
      {icons[label] ?? "●"}
    </Text>
  );
}

// Student tab flow — shown when signed-in user has role === "student"
function StudentNavigator() {
  const insets = useSafeAreaInsets();
  
  return (
    <StudentTab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0F0F13",
          borderTopColor:  "#1e1e28",
          paddingBottom:    insets.bottom + 6,
          paddingTop:       6,
          height:           insets.bottom + 60,
        },
        tabBarActiveTintColor:   "#00C48C",
        tabBarInactiveTintColor: "#555",
        tabBarLabelStyle:        { fontSize: 11, fontWeight: "600" },
        tabBarIcon:              ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <StudentTab.Screen
        name="Home"
        component={StudentHomeScreen}
        options={{ title: "Home" }}
      />
      <StudentTab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ title: "Wallet" }}
      />
      <StudentTab.Screen
        name="Map"
        component={PathfinderScreen}
        options={{ title: "Map" }}
      />
      <StudentTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Profile" }}
      />
    </StudentTab.Navigator>
  );
}

// Rider stack — shown when signed-in user has role === "rider"
function RiderNavigator() {
  return (
    <RiderStack.Navigator screenOptions={{ headerShown: false }}>
      <RiderStack.Screen name="RiderHome" component={RiderHomeScreen} />
      {/* More rider screens added here */}
    </RiderStack.Navigator>
  );
}

// Loading screen while we check auth state
function SplashScreen() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color="#00C48C" />
    </View>
  );
}

// ─── ROOT NAVIGATOR ───────────────────────────────────────────────────────────
/**
 * Listens to Firebase auth state and routes to the correct navigator.
 * Role is pulled from Firestore (same as the old initAuth in auth.js).
 */
export default function RootNavigator() {
  const { setCurrentUser, clearCurrentUser, currentRole } = useStore();
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Pull role + extra data from Firestore, same retry logic as old auth.js
        let userDoc = await getDoc(doc(db, "users", firebaseUser.uid));

        if (!userDoc.exists()) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        }

        const merged = userDoc.exists()
          ? { ...firebaseUser, ...userDoc.data() }
          : firebaseUser;

        setCurrentUser(merged);
        setUser(merged);
      } else {
        clearCurrentUser();
        setUser(null);
      }

      setInitializing(false);
    });

    return unsubscribe;
  }, []);

  if (initializing) return <SplashScreen />;

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        ) : currentRole === "rider" ? (
          <RootStack.Screen name="Rider" component={RiderNavigator} />
        ) : (
          <RootStack.Screen name="Student" component={StudentNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: "#0F0F13",
    alignItems: "center",
    justifyContent: "center"
  }
});
