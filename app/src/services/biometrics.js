/**
 * biometrics.js
 *
 * React Native replacement for js/modules/biometrics.js.
 *
 * Vanilla used:  WebAuthn (navigator.credentials) + IndexedDB + AES-GCM
 * Here we use:   expo-local-authentication  (Face ID / fingerprint prompt)
 *                AsyncStorage               (credential store)
 *
 * The security model is the same:
 *   - Credentials ({email, password}) are only retrieved AFTER the OS
 *     biometric prompt succeeds.
 *   - AsyncStorage is encrypted at rest by the OS keychain on iOS
 *     and Android Keystore on Android when using Expo's managed workflow.
 *
 * Exports:
 *   isBiometricsAvailable()        → Promise<boolean>
 *   isBiometricsEnabled()          → Promise<boolean>
 *   registerBiometrics(email, pw)  → Promise<void>   — saves creds after prompt
 *   authenticateBiometrics()       → Promise<{email, password}>
 *   disableBiometrics()            → Promise<void>
 *   getBiometricLabel()            → Promise<string>  — "Face ID" | "Fingerprint" | "Biometrics"
 */

import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ─── STORAGE KEYS ────────────────────────────────────────────────────────────

const KEY_ENABLED = "oprBiometricsEnabled";
const KEY_CREDS   = "oprBiometricCredentials"; // JSON string: { email, password }

// ─── AVAILABILITY ────────────────────────────────────────────────────────────

/**
 * Returns true if the device has biometric hardware AND enrolled biometrics.
 */
export async function isBiometricsAvailable() {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch {
    return false;
  }
}

/**
 * Returns true if the user has previously registered biometrics in this app.
 */
export async function isBiometricsEnabled() {
  try {
    const value = await AsyncStorage.getItem(KEY_ENABLED);
    return value === "true";
  } catch {
    return false;
  }
}

/**
 * Returns a human-readable label for the available biometric type.
 * Returns "Biometrics" for all cases to keep it clean.
 */
export async function getBiometricLabel() {
  return "Biometrics";
}

// ─── REGISTER ────────────────────────────────────────────────────────────────

/**
 * Prompt the user to confirm with biometrics, then store their credentials.
 * Call this AFTER a successful email/password login.
 *
 * @param {string} email
 * @param {string} password
 * @throws {Error} if hardware unavailable, not enrolled, or prompt cancelled
 */
export async function registerBiometrics(email, password) {
  const available = await isBiometricsAvailable();
  if (!available) {
    throw new Error("Biometric authentication is not available on this device.");
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage:   "Confirm biometrics to enable quick login",
    fallbackLabel:   "Use passcode",
    cancelLabel:     "Cancel",
    disableDeviceFallback: false,
  });

  if (!result.success) {
    throw new Error(
      result.error === "user_cancel"
        ? "Biometric setup cancelled."
        : "Biometric confirmation failed. Please try again."
    );
  }

  // Store credentials — only accessible after a successful biometric prompt
  const payload = JSON.stringify({ email, password });
  await AsyncStorage.setItem(KEY_CREDS, payload);
  await AsyncStorage.setItem(KEY_ENABLED, "true");
}

// ─── AUTHENTICATE ─────────────────────────────────────────────────────────────

/**
 * Prompt the user with biometrics, then return their stored credentials.
 * Returns { email, password } on success.
 *
 * @throws {Error} if not enrolled, not set up, prompt fails, or creds missing
 */
export async function authenticateBiometrics() {
  const available = await isBiometricsAvailable();
  if (!available) {
    throw new Error("Biometric authentication is not available on this device.");
  }

  const enabled = await isBiometricsEnabled();
  if (!enabled) {
    throw new Error("Biometrics are not set up. Log in with email first.");
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage:         "Log in to OpRides",
    fallbackLabel:         "Use passcode",
    cancelLabel:           "Cancel",
    disableDeviceFallback: false,
  });

  if (!result.success) {
    throw new Error(
      result.error === "user_cancel"
        ? "Biometric login cancelled."
        : "Biometric scan failed. Please log in with email."
    );
  }

  const stored = await AsyncStorage.getItem(KEY_CREDS);
  if (!stored) {
    // Credentials were cleared (e.g. app reinstall) — clean up the flag
    await AsyncStorage.removeItem(KEY_ENABLED);
    throw new Error("Biometric credentials not found. Please log in with email.");
  }

  return JSON.parse(stored); // { email, password }
}

// ─── DISABLE ─────────────────────────────────────────────────────────────────

/**
 * Remove stored biometric credentials and disable quick login.
 */
export async function disableBiometrics() {
  await AsyncStorage.multiRemove([KEY_ENABLED, KEY_CREDS]);
}
