import React, { useEffect } from "react";
import { View, Text, StyleSheet, Dimensions, Pressable } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, withRepeat, Easing, FadeIn,
} from "react-native-reanimated";
import { colors, font, spacing, radius } from "@/src/theme";

const { width, height } = Dimensions.get("window");

const PALETTE = ["#E62E2D", "#DFFF00", "#00FA9A", "#FFC107", "#39FF14", "#FF6B6B", "#FFFFFF"];

function Piece({ index }: { index: number }) {
  const startX = (index * 37) % width;
  const ty = useSharedValue(-40);
  const tx = useSharedValue(0);
  const rot = useSharedValue(0);
  useEffect(() => {
    const dur = 1400 + (index % 5) * 260;
    ty.value = withDelay((index % 8) * 60, withTiming(height + 60, { duration: dur, easing: Easing.in(Easing.quad) }));
    tx.value = withRepeat(withSequence(
      withTiming((index % 2 ? 1 : -1) * 26, { duration: 520 }),
      withTiming((index % 2 ? -1 : 1) * 26, { duration: 520 }),
    ), -1, true);
    rot.value = withRepeat(withTiming(360, { duration: 700 }), -1, false);
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { translateX: tx.value }, { rotate: `${rot.value}deg` }],
  }));
  const color = PALETTE[index % PALETTE.length];
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: startX, top: 0, width: 8, height: 14, borderRadius: 2, backgroundColor: color }, style]}
    />
  );
}

export function Confetti({ count = 70 }: { count?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }).map((_, i) => <Piece key={i} index={i} />)}
    </View>
  );
}

type Props = {
  visible: boolean;
  won: boolean;
  headline: string;      // e.g. "LEVEL UP", "NEW PERSONAL BEST", "3 MATCH STREAK", "BETTER LUCK NEXT TIME"
  before?: number | null;
  after?: number | null;
  delta?: number | null;
  tag?: string | null;
  onContinue: () => void;
};

export function ResultOverlay({ visible, won, headline, before, after, delta, tag, onContinue }: Props) {
  const scale = useSharedValue(0.6);
  useEffect(() => {
    if (visible) scale.value = withSequence(withTiming(1.06, { duration: 260 }), withTiming(1, { duration: 160 }));
  }, [visible]);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  if (!visible) return null;
  const accent = won ? colors.success : colors.brand;
  return (
    <View style={styles.backdrop} testID="result-overlay">
      {won && <Confetti />}
      <Animated.View style={[styles.card, { borderColor: accent }, cardStyle]}>
        <Animated.Text entering={FadeIn.duration(300)} style={[styles.result, { color: accent }]}>
          {won ? "VICTORY" : "DEFEAT"}
        </Animated.Text>
        <Text style={styles.headline}>{headline}</Text>
        {tag ? <View style={[styles.tagPill, { borderColor: accent }]}><Text style={[styles.tagText, { color: accent }]}>{tag}</Text></View> : null}
        {(before != null && after != null) && (
          <View style={styles.ratingRow}>
            <View style={styles.ratingCol}>
              <Text style={styles.ratingLabel}>BEFORE</Text>
              <Text style={styles.ratingVal}>{before}</Text>
            </View>
            <Text style={[styles.arrow, { color: accent }]}>→</Text>
            <View style={styles.ratingCol}>
              <Text style={styles.ratingLabel}>NOW</Text>
              <Text style={[styles.ratingVal, { color: accent }]}>{after}</Text>
            </View>
            <View style={styles.deltaBox}>
              <Text style={[styles.deltaText, { color: accent }]}>{(delta ?? 0) >= 0 ? "+" : ""}{delta}</Text>
            </View>
          </View>
        )}
        <Pressable testID="result-continue-btn" onPress={onContinue} style={[styles.continueBtn, { backgroundColor: accent }]}>
          <Text style={styles.continueText}>CONTINUE</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,10,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.lg, zIndex: 999 },
  card: { width: "100%", maxWidth: 380, borderWidth: 2, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary },
  result: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 52, letterSpacing: 3 },
  headline: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, color: colors.onSurface, letterSpacing: 1, textAlign: "center" },
  tagPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tagText: { ...font.textBold, letterSpacing: 1, fontSize: 11 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  ratingCol: { alignItems: "center" },
  ratingLabel: { ...font.textBold, letterSpacing: 2, fontSize: 9, color: colors.onSurfaceTertiary },
  ratingVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 34, color: colors.onSurface },
  arrow: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28 },
  deltaBox: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  deltaText: { ...font.textBold, fontSize: 16 },
  continueBtn: { alignSelf: "stretch", paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, marginTop: spacing.sm },
  continueText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
