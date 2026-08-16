import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Dimensions, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, withRepeat, Easing, FadeIn,
} from "react-native-reanimated";
import { colors, font, spacing, radius } from "@/src/theme";
import { tierColor, Achievement, CelebLevel } from "@/src/gamification";

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
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: startX, top: 0, width: 8, height: 14, borderRadius: 2, backgroundColor: color }, style]} />
  );
}

export function Confetti({ count = 70 }: { count?: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }).map((_, i) => <Piece key={i} index={i} />)}
    </View>
  );
}

/** Quick number tick from `from` to `to` (~600ms). */
function AnimatedNumber({ from, to, color, decimals }: { from: number; to: number; color: string; decimals: number }) {
  const [val, setVal] = useState(from);
  useEffect(() => {
    const steps = 22; const dur = 600; let i = 0;
    const t = setInterval(() => {
      i += 1; const p = i / steps; const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (to - from) * eased);
      if (i >= steps) { setVal(to); clearInterval(t); }
    }, dur / steps);
    return () => clearInterval(t);
  }, [from, to]);
  return <Text style={[styles.ratingVal, { color }]}>{decimals > 0 ? val.toFixed(decimals) : String(Math.round(val))}</Text>;
}

type Props = {
  visible: boolean;
  won: boolean;
  headline: string;
  before?: number | null;
  after?: number | null;
  delta?: number | null;
  tag?: string | null;
  level?: CelebLevel;
  accent?: string;
  subMessage?: string | null;
  achievements?: Achievement[];
  formDots?: string[];
  onShare?: () => void;
  shared?: boolean;
  onContinue: () => void;
};

export function ResultOverlay({
  visible, won, headline, before, after, delta, tag,
  level = "milestone", accent, subMessage, achievements = [], formDots = [], onShare, shared, onContinue,
}: Props) {
  const scale = useSharedValue(0.6);
  const startFrom = useRef<number | null>(null);
  useEffect(() => {
    if (visible) scale.value = withSequence(withTiming(1.06, { duration: 240 }), withTiming(1, { duration: 150 }));
  }, [visible]);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  if (!visible) return null;

  const brandAccent = won ? (accent || colors.success) : colors.brand;
  const showConfetti = level === "trophy";
  const decimals = after != null && !Number.isInteger(after) ? 2 : 0;
  if (startFrom.current == null) startFrom.current = before ?? after ?? 0;

  return (
    <View style={styles.backdrop} testID="result-overlay">
      {showConfetti && <Confetti />}
      <Animated.View style={[styles.card, { borderColor: brandAccent }, cardStyle]}>
        <ScrollView contentContainerStyle={styles.cardInner} showsVerticalScrollIndicator={false}>
          <Animated.Text entering={FadeIn.duration(280)} style={[styles.result, { color: brandAccent }]}>
            {won ? "VICTORY" : "DEFEAT"}
          </Animated.Text>
          <Text style={styles.headline} testID="result-headline">{headline}</Text>
          {subMessage ? <Text style={styles.subMessage}>{subMessage}</Text> : null}

          {tag ? (
            <View style={[styles.tagPill, { borderColor: brandAccent }]}>
              <Text style={[styles.tagText, { color: brandAccent }]}>{tag}</Text>
            </View>
          ) : null}

          {(before != null && after != null) && (
            <View style={styles.ratingRow}>
              <View style={styles.ratingCol}>
                <Text style={styles.ratingLabel}>BEFORE</Text>
                <Text style={styles.ratingValMuted}>{decimals > 0 ? Number(before).toFixed(decimals) : Math.round(Number(before))}</Text>
              </View>
              <Text style={[styles.arrow, { color: brandAccent }]}>→</Text>
              <View style={styles.ratingCol}>
                <Text style={styles.ratingLabel}>NOW</Text>
                <AnimatedNumber from={startFrom.current!} to={Number(after)} color={brandAccent} decimals={decimals} />
              </View>
              {delta != null && (
                <View style={styles.deltaBox}>
                  <Text style={[styles.deltaText, { color: brandAccent }]}>{delta >= 0 ? "+" : ""}{delta}</Text>
                </View>
              )}
            </View>
          )}

          {formDots.length > 0 && (
            <View style={styles.formRow}>
              {formDots.slice(-5).map((f, i) => (
                <View key={i} style={[styles.formDot, { backgroundColor: f === "W" ? colors.success : colors.error }]}>
                  <Text style={styles.formDotText}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {achievements.length > 0 && (
            <View style={styles.achWrap} testID="result-achievements">
              <Text style={styles.achLabel}>UNLOCKED</Text>
              {achievements.map((a) => (
                <View key={a.code} style={[styles.achRow, { borderColor: tierColor(a.tier) + "99" }]}>
                  <View style={[styles.achIcon, { borderColor: tierColor(a.tier) }]}>
                    <Ionicons name={a.icon as any} size={16} color={tierColor(a.tier)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.achTitle}>{a.title}</Text>
                    {a.desc ? <Text style={styles.achDesc} numberOfLines={1}>{a.desc}</Text> : null}
                  </View>
                  <Text style={[styles.achTier, { color: tierColor(a.tier) }]}>{(a.tier || "").toUpperCase()}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {onShare && (
              <Pressable testID="result-share-btn" onPress={onShare} disabled={shared} style={[styles.shareBtn, { borderColor: brandAccent }, shared && { opacity: 0.6 }]}>
                <Ionicons name={shared ? "checkmark" : "share-social-outline"} size={16} color={brandAccent} />
                <Text style={[styles.shareText, { color: brandAccent }]}>{shared ? "SHARED" : "SHARE"}</Text>
              </Pressable>
            )}
            <Pressable testID="result-continue-btn" onPress={onContinue} style={[styles.continueBtn, { backgroundColor: brandAccent }]}>
              <Text style={styles.continueText}>CONTINUE</Text>
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,10,0.94)", alignItems: "center", justifyContent: "center", padding: spacing.lg, zIndex: 999 },
  card: { width: "100%", maxWidth: 400, maxHeight: "88%", borderWidth: 2, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  cardInner: { padding: spacing.lg, alignItems: "center", gap: spacing.md },
  result: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 48, letterSpacing: 3 },
  headline: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface, letterSpacing: 1, textAlign: "center" },
  subMessage: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, textAlign: "center", marginTop: -6 },
  tagPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tagText: { ...font.textBold, letterSpacing: 1, fontSize: 11, textAlign: "center" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xs },
  ratingCol: { alignItems: "center" },
  ratingLabel: { ...font.textBold, letterSpacing: 2, fontSize: 9, color: colors.onSurfaceTertiary },
  ratingVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 34 },
  ratingValMuted: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 34, color: colors.onSurfaceSecondary },
  arrow: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26 },
  deltaBox: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  deltaText: { ...font.textBold, fontSize: 16 },
  formRow: { flexDirection: "row", gap: 6 },
  formDot: { width: 22, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  formDotText: { ...font.textBold, fontSize: 11, color: "#0B0D12" },
  achWrap: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.xs },
  achLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceTertiary, textAlign: "center" },
  achRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface },
  achIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  achTitle: { ...font.textBold, fontSize: 13, color: colors.onSurface },
  achDesc: { ...font.text, fontSize: 10, color: colors.onSurfaceTertiary },
  achTier: { ...font.textBold, letterSpacing: 1, fontSize: 8 },
  actions: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch", marginTop: spacing.sm },
  shareBtn: { flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  shareText: { ...font.textBold, letterSpacing: 2, fontSize: 12 },
  continueBtn: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  continueText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
