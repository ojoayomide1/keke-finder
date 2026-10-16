/**
 * src/components/Icon.js
 *
 * Lucide icons via lucide-react-native (works on iOS, Android, and Web
 * when metro.config.js resolves react-native-svg to its web entry).
 *
 * Usage: <Icon name="compass" size={22} color={C.brand} />
 */

import React from "react";
import {
  Car, Compass, Wallet, User, MapPin, Search, Sparkles,
  Footprints, Stairs, DoorOpen, Receipt, LifeBuoy,
  ChevronRight, ChevronLeft, X, Check, Star, Clock,
  Navigation, ArrowLeft, Send, Mic, Map, Home,
  Banknote, TrendingUp, CircleAlert, Info, Building2,
  GraduationCap, Utensils, BedDouble, FlaskConical,
  Dumbbell, LogOut, Phone, Mail, RefreshCw,
} from "lucide-react-native";

const ICONS = {
  "car":           Car,
  "compass":       Compass,
  "wallet":        Wallet,
  "user":          User,
  "map-pin":       MapPin,
  "search":        Search,
  "sparkles":      Sparkles,
  "footprints":    Footprints,
  "stairs":        Stairs,
  "door-open":     DoorOpen,
  "receipt":       Receipt,
  "life-buoy":     LifeBuoy,
  "chevron-right": ChevronRight,
  "chevron-left":  ChevronLeft,
  "x":             X,
  "check":         Check,
  "star":          Star,
  "clock":         Clock,
  "navigation":    Navigation,
  "arrow-left":    ArrowLeft,
  "send":          Send,
  "mic":           Mic,
  "map":           Map,
  "home":          Home,
  "banknote":      Banknote,
  "trending-up":   TrendingUp,
  "circle-alert":  CircleAlert,
  "info":          Info,
  "building":      Building2,
  "graduation-cap":GraduationCap,
  "utensils":      Utensils,
  "bed":           BedDouble,
  "flask":         FlaskConical,
  "dumbbell":      Dumbbell,
  "log-out":       LogOut,
  "phone":         Phone,
  "mail":          Mail,
  "refresh":       RefreshCw,
};

export default function Icon({ name, size = 20, color = "#14171A", strokeWidth = 1.75 }) {
  const LucideIcon = ICONS[name];
  if (!LucideIcon) {
    if (__DEV__) console.warn(`[Icon] Unknown icon: "${name}"`);
    return null;
  }
  return <LucideIcon size={size} color={color} strokeWidth={strokeWidth} />;
}
