import React, { useEffect } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, FadeOutUp, useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { colors, spacing, radius, font } from "@/src/theme";

export type CelebrationKind = "level_up" | "personal_best" | "streak" | "top10" | "keep_it_up" | "competition_win";

const META: Record<CelebrationKind, { icon: any; color: string; title: string }> = {
  level_up: { icon: "trending-up", color: "#4C8DFF", title: "LEVEL UP" },
  personal_best: { icon: "star", color: "#FFC107", title: "NEW PERSONAL BEST" },
  streak: { icon: "flame", color: "#FF6B4A", title: "ON A STREAK" },
  top10: { icon: "ribbon", color: "#00FA9A", title: "TOP 10" },
  keep_it_up: { icon: "rocket", color: "#A88BFF", title: "KEEP IT UP" },
  competition_win: { icon: "trophy", color: "#FFD54A", title: "CHAMPION" },
};

export default function CelebrationBanner({ kind, message, onDone }: { kind: CelebrationKind; message: string; onDone?: () => void }) {
  const m = META[kind];
  const pulse = useSharedValue(1);

  useEffect(() => {
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
    pulse.value = withRepeat(withSequence(withTiming(1.12, { duration: 420 }), withTiming(1, { duration: 420 })), 4, false);
    const t = setTimeout(() => onDone?.(), 3200);
    return () => clearTimeout(t);
  }, [pulse, onDone]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View entering={FadeInDown.duration(350)} exiting={FadeOutUp.duration(250)} style={[styles.wrap, { borderColor: m.color }]} testID={`celebration-${kind}`}>
      <Animated.View style={[styles.iconWrap, { backgroundColor: m.color + "22" }, iconStyle]}>
        <Ionicons name={m.icon} size={22} color={m.color} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: m.color }]}>{m.title}</Text>
        <Text style={styles.msg} numberOfLines={2}>{message}</Text>
      </View>
      <Pressable testID="celebration-dismiss" onPress={onDone} hitSlop={10}><Ionicons name="close" size={18} color={colors.onSurfaceSecondary} /></Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  title: { ...font.textBold, letterSpacing: 2, fontSize: 12 },
  msg: { ...font.textMedium, fontSize: 13, color: colors.onSurface, marginTop: 2 },
});
