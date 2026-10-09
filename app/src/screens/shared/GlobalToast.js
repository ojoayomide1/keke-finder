import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import useStore from "../../store";

const COLORS = {
  success: "#1E7A46",
  error:   "#ef4444",
  info:    "#3b82f6",
  warning: "#f59e0b",
};

export default function GlobalToast() {
  const toastMessage = useStore((state) => state.toastMessage);
  const opacity      = useRef(new Animated.Value(0)).current;
  // Keep last message visible while fading out
  const lastMsg      = useRef(null);

  useEffect(() => {
    if (toastMessage) {
      lastMsg.current = toastMessage;
      Animated.timing(opacity, {
        toValue:         1,
        duration:        200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue:         0,
        duration:        300,
        useNativeDriver: true,
      }).start();
    }
  }, [toastMessage]);

  const msg = toastMessage || lastMsg.current;
  if (!msg) return null;

  const color = COLORS[msg.type] || COLORS.info;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity }]}
    >
      <Animated.View style={[styles.toast, { borderColor: color }]}>
        <Text style={styles.text}>{msg.text}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position:   "absolute",
    top:        52,
    left:       16,
    right:      16,
    zIndex:     9999,
    elevation:  9999,
    alignItems: "center",
  },
  toast: {
    maxWidth:          520,
    width:             "100%",
    backgroundColor:   "#FFFFFF",
    borderWidth:       1,
    borderRadius:      12,
    paddingHorizontal: 14,
    paddingVertical:   12,
    shadowColor:       "#000",
    shadowOpacity:     0.25,
    shadowRadius:      12,
    shadowOffset:      { width: 0, height: 6 },
  },
  text: {
    color:      "#0F1117",
    fontSize:   14,
    fontWeight: "700",
    lineHeight: 19,
  },
});
