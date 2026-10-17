/**
 * src/components/NavBot.js
 *
 * NavBot chat UI — renders as a bottom sheet or inline panel.
 * Used by ExploreScreen when the query looks like a question
 * or the user taps "Ask NavBot".
 *
 * Props:
 *   visible      boolean
 *   initialQuery string    — pre-fill from search bar
 *   onClose      Function
 *   onNavigate   Function(place)
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView,
  Modal, Platform, Pressable, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";

import { askNavBot, isNavBotAvailable } from "../services/navbot";
import { getCategoryMeta } from "../services/places";
import Icon from "./Icon";
import { C as TC, S, R } from "../theme/tokens";

const C = {
  bg:        TC.bg,
  surface:   TC.surface,
  surface2:  TC.surface2,
  border:    TC.border,
  brand:     TC.brand,
  brandSoft: TC.brandSoft,
  text:      TC.text,
  text2:     TC.text2,
  text3:     TC.text3,
};

// ─── PLACE CARD (inside chat) ─────────────────────────────────────────────────
function ChatPlaceCard({ place, onNavigate }) {
  const meta = getCategoryMeta(place.category);
  const sub  = place.scope === "indoor"
    ? [place.buildingName, place.floorLabel, place.room !== place.name ? place.room : null].filter(Boolean).join(" · ")
    : meta.label;

  return (
    <View style={styles.chatCard}>
      <View style={[styles.chatCardIcon, { backgroundColor: meta.color + "18" }]}>
        <Icon name={meta.icon} size={18} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.chatCardName}>{place.name}</Text>
        <Text style={styles.chatCardSub} numberOfLines={1}>{sub}</Text>
      </View>
      <TouchableOpacity style={styles.chatCardNav} onPress={() => onNavigate(place)} activeOpacity={0.8}>
        <Icon name="navigation" size={14} color="#fff" />
        <Text style={styles.chatCardNavText}>Go</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── MESSAGE BUBBLE ───────────────────────────────────────────────────────────
function Message({ msg, onNavigate, onFollowUp }) {
  if (msg.role === "user") {
    return (
      <View style={styles.userBubbleWrap}>
        <View style={styles.userBubble}>
          <Text style={styles.userBubbleText}>{msg.text}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.botBubbleWrap}>
      <View style={styles.botAvatar}>
        <Icon name="sparkles" size={14} color={C.brand} />
      </View>
      <View style={{ flex: 1 }}>
        {msg.loading ? (
          <View style={styles.botBubble}>
            <ActivityIndicator size="small" color={C.brand} />
          </View>
        ) : (
          <>
            <View style={styles.botBubble}>
              <Text style={styles.botBubbleText}>{msg.text}</Text>
            </View>

            {/* Place cards */}
            {msg.places?.map(p => (
              <ChatPlaceCard key={p.id} place={p} onNavigate={onNavigate} />
            ))}

            {/* Follow-up chips */}
            {msg.followUps?.length > 0 && (
              <View style={styles.followUps}>
                {msg.followUps.map((q, i) => (
                  <TouchableOpacity key={i} style={styles.followUpChip} onPress={() => onFollowUp(q)} activeOpacity={0.75}>
                    <Text style={styles.followUpText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NavBot({ visible, initialQuery = "", onClose, onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [sending,  setSending]  = useState(false);
  const listRef   = useRef(null);
  const inputRef  = useRef(null);

  // Pre-fill from search bar query when opened
  useEffect(() => {
    if (visible && initialQuery && messages.length === 0) {
      sendMessage(initialQuery);
    }
  }, [visible, initialQuery]);

  // Scroll to bottom after new message
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  async function sendMessage(text) {
    const q = (text ?? input).trim();
    if (!q || sending) return;

    setInput("");
    setSending(true);

    // Add user message + bot loading placeholder
    const userId  = Date.now();
    const botId   = userId + 1;
    setMessages(prev => [
      ...prev,
      { id: userId, role: "user",  text: q },
      { id: botId,  role: "bot",   text: "", loading: true },
    ]);

    const response = await askNavBot(q);

    setMessages(prev => prev.map(m => m.id === botId
      ? {
          ...m,
          loading:   false,
          text:      response.message,
          places:    response.places,
          followUps: response.followUps,
          ok:        response.ok,
        }
      : m
    ));

    setSending(false);
    setTimeout(() => inputRef.current?.focus(), 200);
  }

  function handleClose() {
    setMessages([]);
    setInput("");
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <Pressable style={styles.overlay} onPress={handleClose} />
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="sparkles" size={18} color={C.brand} />
            <Text style={styles.headerTitle}>NavBot</Text>
            <View style={styles.betaBadge}><Text style={styles.betaText}>AI</Text></View>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="x" size={20} color={C.text2} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => String(m.id)}
          renderItem={({ item }) => (
            <Message
              msg={item}
              onNavigate={(p) => { handleClose(); onNavigate(p); }}
              onFollowUp={(q) => sendMessage(q)}
            />
          )}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Icon name="sparkles" size={32} color={C.text3} />
              <Text style={styles.emptyChatTitle}>Ask about campus</Text>
              <Text style={styles.emptyChatSub}>Try "where is the Dean's office?" or "who teaches CSC 301?"</Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
        />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Ask about campus…"
            placeholderTextColor={C.text3}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            multiline={false}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || sending}
            activeOpacity={0.8}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="send" size={16} color="#fff" />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor:      C.surface,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    maxHeight:            "85%",
    paddingBottom:        Platform.OS === "ios" ? 34 : 16,
  },

  header: {
    flexDirection:  "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.xl, paddingVertical: S.md,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft:  { flexDirection: "row", alignItems: "center", gap: S.sm },
  headerTitle: { fontSize: 16, fontWeight: "600", color: C.text },
  betaBadge:   { backgroundColor: C.brandSoft, borderRadius: R.chip, paddingHorizontal: 7, paddingVertical: 2 },
  betaText:    { fontSize: 10, fontWeight: "700", color: C.brand, letterSpacing: 0.5 },

  messageList: { padding: S.base, gap: S.base, flexGrow: 1 },

  // User bubble
  userBubbleWrap: { alignItems: "flex-end", marginBottom: S.sm },
  userBubble:     { backgroundColor: C.brand, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: S.md, paddingVertical: S.sm, maxWidth: "80%" },
  userBubbleText: { color: "#fff", fontSize: 14, lineHeight: 20 },

  // Bot bubble
  botBubbleWrap: { flexDirection: "row", alignItems: "flex-start", gap: S.sm, marginBottom: S.sm },
  botAvatar:     { width: 28, height: 28, borderRadius: 14, backgroundColor: C.brandSoft, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  botBubble:     { backgroundColor: C.surface2, borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: S.md, paddingVertical: S.sm, maxWidth: "85%", minHeight: 36, justifyContent: "center" },
  botBubbleText: { color: C.text, fontSize: 14, lineHeight: 20 },

  // Chat place card
  chatCard: {
    flexDirection: "row", alignItems: "center", gap: S.sm,
    backgroundColor: C.surface, borderRadius: R.card,
    borderWidth: 1, borderColor: C.border,
    padding: S.sm, marginTop: S.xs, maxWidth: "85%",
  },
  chatCardIcon:    { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chatCardName:    { fontSize: 13, fontWeight: "600", color: C.text },
  chatCardSub:     { fontSize: 11, color: C.text3, marginTop: 1 },
  chatCardNav:     { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 0 },
  chatCardNavText: { color: "#fff", fontSize: 12, fontWeight: "600" },

  // Follow-ups
  followUps:     { flexDirection: "row", flexWrap: "wrap", gap: S.xs, marginTop: S.sm },
  followUpChip:  { backgroundColor: C.surface2, borderRadius: R.chip, borderWidth: 1, borderColor: C.border, paddingHorizontal: S.sm, paddingVertical: 6 },
  followUpText:  { fontSize: 12, color: C.text2 },

  // Empty state
  emptyChat:      { alignItems: "center", paddingVertical: 40, gap: S.sm },
  emptyChatTitle: { fontSize: 16, fontWeight: "600", color: C.text },
  emptyChatSub:   { fontSize: 13, color: C.text3, textAlign: "center", lineHeight: 18, paddingHorizontal: S.xl },

  // Input
  inputBar: {
    flexDirection: "row", alignItems: "center", gap: S.sm,
    paddingHorizontal: S.base, paddingVertical: S.sm,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  input: {
    flex: 1, backgroundColor: C.surface2, borderRadius: R.chip,
    paddingHorizontal: S.md, paddingVertical: S.sm + 2,
    fontSize: 14, color: C.text, minHeight: 44,
  },
  sendBtn:         { width: 44, height: 44, borderRadius: 22, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: { opacity: 0.4 },
});
