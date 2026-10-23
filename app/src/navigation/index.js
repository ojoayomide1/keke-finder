import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ActivityIndicator, Platform, Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, onAuthStateChanged, db, doc, getDoc } from "../config/firebase";
import useStore from "../store";
import { registerForPushNotifications } from "../services/notifications";
import { C, S } from "../theme/tokens";
import Icon from "../components/Icon";

// ─── SCREENS ─────────────────────────────────────────────────────────────────
import LoginScreen        from "../screens/auth/LoginScreen";
import StudentHomeScreen  from "../screens/student/HomeScreen";
import WalletScreen       from "../screens/student/WalletScreen";
import ProfileScreen      from "../screens/student/ProfileScreen";
import PathfinderScreen   from "../screens/student/PathfinderScreen";
import MapScreen          from "../screens/student/MapScreen";
import RiderHomeScreen    from "../screens/rider/HomeScreen";
import RiderEarningsScreen from "../screens/rider/EarningsScreen";
import RiderMapScreen     from "../screens/rider/MapScreen";
import RiderProfileScreen from "../screens/rider/ProfileScreen";

// ─── NAVIGATORS ──────────────────────────────────────────────────────────────
const AuthStack  = createNativeStackNavigator();
const StudentTab = createBottomTabNavigator();
const RiderTab   = createBottomTabNavigator();
const RootStack  = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

// ─── TAB ICON CONFIG ─────────────────────────────────────────────────────────
// Tab name → Lucide icon name (or "emoji:X" for emoji fallback)
const STUDENT_ICONS = {
  Ride:    "emoji:🛺",
  Wallet:  "wallet",
  Map:     "map",
  Explore: "compass",
  Profile: "user",
};

const RIDER_ICONS = {
  Home:     "home",
  Earnings: "trending-up",
  Map:      "map",
  Profile:  "user",
};

function StudentTabIcon({ name, focused }) {
  const iconKey = STUDENT_ICONS[name] ?? "circle-alert";
  if (iconKey.startsWith("emoji:")) {
    return (
      <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>
        {iconKey.slice(6)}
      </Text>
    );
  }
  return (
    <Icon
      name={iconKey}
      size={22}
      color={focused ? C.brand : C.text3}
      strokeWidth={focused ? 2 : 1.75}
    />
  );
}

function RiderTabIcon({ name, focused }) {
  return (
    <Icon
      name={RIDER_ICONS[name] ?? "circle-alert"}
      size={22}
      color={focused ? C.brand : C.text3}
      strokeWidth={focused ? 2 : 1.75}
    />
  );
}

// ─── SHARED TAB BAR OPTIONS ───────────────────────────────────────────────────
function tabBarStyle(insets) {
  const bottomInset = Platform.OS === "web" ? 0 : insets.bottom;
  return {
    backgroundColor:  C.surface,
    borderTopColor:   C.border,
    borderTopWidth:   1,
    paddingBottom:    bottomInset + 10,
    paddingTop:       8,
    height:           bottomInset + 66,
    elevation:        0,
    shadowOpacity:    0,
  };
}

// ─── STUDENT NAVIGATOR ────────────────────────────────────────────────────────
function StudentNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <StudentTab.Navigator
      screenOptions={({ route }) => ({
        headerShown:           false,
        tabBarStyle:           tabBarStyle(insets),
        tabBarActiveTintColor:   C.brand,
        tabBarInactiveTintColor: C.text3,
        tabBarLabelStyle: {
          fontSize:   11,
          fontWeight: "500",
          fontFamily: "Inter_500Medium",
          marginTop:  2,
        },
        tabBarIcon: ({ focused }) => (
          <StudentTabIcon name={route.name} focused={focused} />
        ),
      })}
    >
      {/* "Home" renamed to "Ride" */}
      <StudentTab.Screen
        name="Ride"
        component={StudentHomeScreen}
        options={{ title: "Ride" }}
      />
      <StudentTab.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ title: "Wallet" }}
      />
      <StudentTab.Screen
        name="Map"
        component={MapScreen}
        options={{ title: "Map" }}
      />
      {/* "Pathfinder" renamed to "Explore" */}
      <StudentTab.Screen
        name="Explore"
        component={PathfinderScreen}
        options={{ title: "Explore" }}
      />
      <StudentTab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: "Profile" }}
      />
    </StudentTab.Navigator>
  );
}

// ─── RIDER NAVIGATOR ──────────────────────────────────────────────────────────
function RiderNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <RiderTab.Navigator
      screenOptions={({ route }) => ({
        headerShown:             false,
        tabBarStyle:             tabBarStyle(insets),
        // Riders share the same brand colour — no more orange
        tabBarActiveTintColor:   C.brand,
        tabBarInactiveTintColor: C.text3,
        tabBarLabelStyle: {
          fontSize:   11,
          fontWeight: "500",
          fontFamily: "Inter_500Medium",
          marginTop:  2,
        },
        tabBarIcon: ({ focused }) => (
          <RiderTabIcon name={route.name} focused={focused} />
        ),
      })}
    >
      <RiderTab.Screen name="Home"     component={RiderHomeScreen}     options={{ title: "Home"     }} />
      <RiderTab.Screen name="Earnings" component={RiderEarningsScreen} options={{ title: "Earnings" }} />
      <RiderTab.Screen name="Map"      component={RiderMapScreen}      options={{ title: "Map"      }} />
      <RiderTab.Screen name="Profile"  component={RiderProfileScreen}  options={{ title: "Profile"  }} />
    </RiderTab.Navigator>
  );
}

// ─── SPLASH ───────────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={C.brand} />
    </View>
  );
}

// ─── ROOT NAVIGATOR ───────────────────────────────────────────────────────────
export default function RootNavigator() {
  const { setCurrentUser, clearCurrentUser, currentRole } = useStore();
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        let userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        if (!userDoc.exists()) {
          await new Promise((r) => setTimeout(r, 1000));
          userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        }
        const merged = userDoc.exists()
          ? { ...firebaseUser, ...userDoc.data() }
          : firebaseUser;
        setCurrentUser(merged);
        setUser(merged);
        registerForPushNotifications(firebaseUser.uid).catch(() => {});
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
          <RootStack.Screen name="Auth"    component={AuthNavigator}    />
        ) : currentRole === "rider" ? (
          <RootStack.Screen name="Rider"   component={RiderNavigator}   />
        ) : (
          <RootStack.Screen name="Student" component={StudentNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex:            1,
    backgroundColor: C.bg,
    alignItems:      "center",
    justifyContent:  "center",
  },
});
