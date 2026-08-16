/**
 * notifications.js
 *
 * Push notification helpers for OpRides.
 *
 * Provides:
 *   registerForPushNotifications(userId)  — request permission, get token, save to Firestore
 *   sendLocalNotification(title, body, data)  — schedule an immediate local notification
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { db, doc, updateDoc } from "../config/firebase";

// ─── FOREGROUND HANDLER ──────────────────────────────────────────────────────
// Controls how notifications look when the app is already open.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

// ─── REGISTER ────────────────────────────────────────────────────────────────

/**
 * Request notification permission, obtain an Expo push token, and store it
 * on the user's Firestore document at users/{userId}.pushToken.
 *
 * @param {string} userId  Firebase uid of the currently signed-in user
 * @returns {string|null}  The Expo push token, or null if permission denied
 */
export async function registerForPushNotifications(userId) {
  try {
    // Android requires an explicit notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name:       "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor:       "#00C48C",
      });
    }

    // 1. Request permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("[Notifications] Permission not granted.");
      return null;
    }

    // 2. Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token     = tokenData.data;

    // 3. Save token to Firestore
    if (userId && token) {
      await updateDoc(doc(db, "users", userId), { pushToken: token });
    }

    return token;
  } catch (err) {
    // Non-fatal — device may not support push (e.g. simulator)
    console.warn("[Notifications] registerForPushNotifications failed:", err?.message ?? err);
    return null;
  }
}

// ─── LOCAL NOTIFICATION ──────────────────────────────────────────────────────

/**
 * Schedule an immediate local notification.
 *
 * @param {string} title  Notification title
 * @param {string} body   Notification body text
 * @param {object} data   Optional extra payload attached to the notification
 */
export async function sendLocalNotification(title, body, data = {}) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
      },
      trigger: null, // null = deliver immediately
    });
  } catch (err) {
    console.warn("[Notifications] sendLocalNotification failed:", err?.message ?? err);
  }
}
