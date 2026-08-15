import React, { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { colors, spacing, font } from "@/src/theme";
import { useAuth } from "@/src/auth-context";

const HERO_BG = "https://images.pexels.com/photos/30566478/pexels-photo-30566478.jpeg";
const AUTO_ADVANCE_MS = 2600;

export default function OpeningScreen() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const navigated = useRef(false);

  // Progress bar + ambient glow animations
  const progress = useSharedValue(0);
  const glow = useSharedValue(0);

  const go = () => {
    if (navigated.current) return;
    navigated.current = true;
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    if (user) {
      router.replace(user.onboarded ? "/(tabs)" : "/onboarding/sports");
    } else {
      router.replace("/auth");
    }
  };

  useEffect(() => {
    progress.value = withTiming(1, { duration: AUTO_ADVANCE_MS, easing: Easing.inOut(Easing.ease) });
    glow.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  // Auto-advance once auth is ready and the intro has played.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(go, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [ready, user]);

  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.35 + glow.value * 0.4, transform: [{ scale: 1 + glow.value * 0.08 }] }));

  return (
    <Pressable style={styles.root} onPress={go} testID="opening-screen">
      {/* Hero photo, heavily darkened */}
      <Image source={HERO_BG} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, opacity: 0.72 }]} />

      {/* Ambient brand glow from top */}
      <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
        <LinearGradient
          colors={["rgba(124,92,255,0.55)", "rgba(124,92,255,0.0)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      {/* Diagonal court-line accents for sport texture */}
      <View style={styles.courtLines} pointerEvents="none">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.courtLine, { top: 120 + i * 150, transform: [{ rotate: "-18deg" }] }]} />
        ))}
      </View>

      {/* Vignette bottom for legibility */}
      <LinearGradient
        colors={["transparent", "rgba(10,14,39,0.65)", colors.surface]}
        locations={[0.35, 0.75, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Animated.View entering={FadeInDown.delay(100).duration(600)} style={styles.eyebrowWrap}>
            <View style={styles.eyebrowDot} />
            <Text style={styles.eyebrow}>ATHLERA</Text>
            <View style={styles.eyebrowDot} />
          </Animated.View>
        </View>

        <View style={styles.center}>
          <Animated.View entering={FadeIn.delay(260).duration(800)} style={{ alignItems: "center" }}>
            <Text style={styles.wordmark} testID="opening-wordmark">ATHLERA</Text>
            <LinearGradient
              colors={[colors.brand, colors.brandSecondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.wordmarkBar}
            />
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(520).duration(700)} style={styles.tagline}>
            ERA OF THE ATHLETE
          </Animated.Text>
        </View>

        <View style={styles.bottom}>
          {!ready ? (
            <ActivityIndicator color={colors.brandSecondary} />
          ) : (
            <Animated.View entering={FadeIn.delay(700).duration(600)} style={{ width: "100%", alignItems: "center", gap: spacing.md }}>
              <View style={styles.progressTrack} testID="opening-progress">
                <Animated.View style={[styles.progressFill, progressStyle]}>
                  <LinearGradient colors={[colors.brand, colors.brandSecondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                </Animated.View>
              </View>
              <Text style={styles.enter}>ENTERING · TAP TO SKIP</Text>
            </Animated.View>
          )}
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  glow: { position: "absolute", top: -160, left: -60, right: -60, height: 460 },
  courtLines: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  courtLine: {
    position: "absolute",
    left: -80,
    right: -80,
    height: 1,
    backgroundColor: "rgba(168,139,255,0.12)",
  },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  top: { alignItems: "center", paddingTop: spacing.lg },
  eyebrowWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyebrowDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.brand },
  eyebrow: { ...font.textBold, letterSpacing: 7, fontSize: 12, color: colors.onSurfaceSecondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  wordmark: {
    fontFamily: "BarlowCondensed",
    fontWeight: "700",
    fontSize: 76,
    lineHeight: 80,
    color: colors.onSurface,
    letterSpacing: 6,
    textShadowColor: "rgba(124,92,255,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  wordmarkBar: { marginTop: spacing.sm, height: 5, width: 120, borderRadius: 3 },
  tagline: { ...font.textMedium, fontSize: 13, letterSpacing: 9, color: colors.brandSecondary },
  bottom: { alignItems: "center", paddingBottom: spacing.xl, width: "100%" },
  progressTrack: { width: 180, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2, overflow: "hidden" },
  enter: { ...font.textBold, letterSpacing: 4, fontSize: 10, color: colors.onSurfaceTertiary },
});
