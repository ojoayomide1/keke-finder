/**
 * SupportModal.js
 *
 * Reusable slide-up modal for submitting support / help requests.
 * Writes to the Firestore `support_requests` collection.
 *
 * Usage
 * ─────
 *   import SupportModal from '../shared/SupportModal';
 *
 *   <SupportModal
 *     visible={showSupport}
 *     onClose={() => setShowSupport(false)}
 *   />
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { db, collection, addDoc, serverTimestamp } from "../../config/firebase";
import useStore from "../../store";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const CATEGORIES = ["Ride Issue", "Payment", "App Bug", "Safety", "Other"];

const C = {
  bg:        "#0F0F13",
  surface:   "#1A1A22",
  surface2:  "#22222c",
  border:    "#2a2a35",
  green:     "#00C48C",
  greenMute: "rgba(0,196,140,0.12)",
  text:      "#FFFFFF",
  sub:       "#888",
  error:     "#ef4444",
  overlay:   "rgba(0,0,0,0.72)",
};

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function SupportModal({ visible, onClose }) {
  const { currentUser, showToast } = useStore();

  const [category,    setCategory]    = useState("Ride Issue");
  const [subject,     setSubject]     = useState("");
  const [description, setDescription] = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);

  // ── Reset form when modal opens ──────────────────────────────────────────
  function handleOpen() {
    setCategory("Ride Issue");
    setSubject("");
    setDescription("");
    setSubmitting(false);
    setSubmitted(false);
  }

  // ── Submit to Firestore ──────────────────────────────────────────────────
  async function handleSubmit() {
    if (!subject.trim()) {
      showToast("Please enter a subject.", "error");
      return;
    }
    if (!description.trim()) {
      showToast("Please describe your issue.", "error");
      return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, "support_requests"), {
        userId:      currentUser?.uid       ?? null,
        userName:    currentUser?.name      ?? currentUser?.displayName ?? "Unknown",
        userEmail:   currentUser?.email     ?? null,
        userRole:    currentUser?.role      ?? "student",
        category,
        subject:     subject.trim(),
        description: description.trim(),
        status:      "open",
        createdAt:   serverTimestamp(),
      });

      setSubmitted(true);

      // Auto-close after 1.5 s
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error("[SupportModal] submit error:", err);
      showToast("Failed to submit request. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onShow={handleOpen}
      onRequestClose={onClose}
    >
      {/* Backdrop — tap to close */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          {/* ── Drag handle ─────────────────────────────────────── */}
          <View style={styles.handle} />

          {/* ── Header ──────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.title}>Report an Issue</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ── Content ─────────────────────────────────────────── */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {submitted ? (
              /* ── Success state ────────────────────────────────── */
              <View style={styles.successContainer}>
                <Text style={styles.successIcon}>✅</Text>
                <Text style={styles.successTitle}>Request Submitted!</Text>
                <Text style={styles.successSub}>
                  We've received your report and will get back to you shortly.
                </Text>
              </View>
            ) : (
              <>
                {/* ── Category picker ─────────────────────────── */}
                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryRow}>
                  {CATEGORIES.map((cat) => {
                    const active = category === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.catChip, active && styles.catChipActive]}
                        onPress={() => setCategory(cat)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* ── Subject ─────────────────────────────────── */}
                <Text style={styles.label}>Subject</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Brief title of your issue"
                  placeholderTextColor={C.sub}
                  value={subject}
                  onChangeText={setSubject}
                  maxLength={120}
                  returnKeyType="next"
                />

                {/* ── Description ─────────────────────────────── */}
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  placeholder="Describe the issue in detail…"
                  placeholderTextColor={C.sub}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  maxLength={1000}
                />

                {/* ── Submit button ────────────────────────────── */}
                <TouchableOpacity
                  style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.submitText}>Submit Request</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.overlay,
  },

  keyboardView: {
    flex:           1,
    justifyContent: "flex-end",
    pointerEvents:  "box-none",
  },

  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingBottom:        Platform.OS === "ios" ? 40 : 28,
    maxHeight:            "88%",
  },

  handle: {
    alignSelf:     "center",
    width:         44,
    height:        4,
    borderRadius:  2,
    backgroundColor: C.border,
    marginTop:     12,
    marginBottom:  4,
  },

  header: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    paddingHorizontal: 20,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title:     { color: C.text, fontSize: 18, fontWeight: "700" },
  closeBtn:  { padding: 4 },
  closeIcon: { color: C.sub, fontSize: 16, fontWeight: "600" },

  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },

  label: {
    color:        C.sub,
    fontSize:     12,
    fontWeight:   "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom:  8,
    marginTop:     14,
  },

  // Category chips
  categoryRow: {
    flexDirection: "row",
    flexWrap:      "wrap",
    gap:           8,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      20,
    borderWidth:       1,
    borderColor:       C.border,
    backgroundColor:   C.surface2,
  },
  catChipActive: {
    borderColor:     C.green,
    backgroundColor: C.greenMute,
  },
  catChipText: {
    color:      C.sub,
    fontSize:   13,
    fontWeight: "600",
  },
  catChipTextActive: {
    color: C.green,
  },

  // Inputs
  input: {
    backgroundColor: C.surface2,
    borderWidth:     1,
    borderColor:     C.border,
    borderRadius:    12,
    paddingHorizontal: 14,
    paddingVertical:   12,
    color:           C.text,
    fontSize:        14,
  },
  inputMultiline: {
    minHeight:   110,
    paddingTop:  12,
  },

  // Submit
  submitBtn: {
    marginTop:       24,
    backgroundColor: C.green,
    borderRadius:    14,
    paddingVertical: 14,
    alignItems:      "center",
  },
  submitBtnDisabled: {
    opacity: 0.55,
  },
  submitText: {
    color:      "#fff",
    fontWeight: "700",
    fontSize:   15,
  },

  // Success
  successContainer: {
    alignItems:    "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  successIcon:  { fontSize: 52, marginBottom: 16 },
  successTitle: { color: C.text, fontSize: 20, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  successSub:   { color: C.sub, fontSize: 14, textAlign: "center", lineHeight: 22 },
});
