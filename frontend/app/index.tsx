import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn, FadeInDown, useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withSequence, Easing,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { spacing, font, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";

// Premium deep navy-blue splash with a subtle animated glow + drifting motion.
const NAVY_DEEP = "#04081C";
const NAVY = "#0A1A4D";
const NAVY_MID = "#0A0E27";
const GLOW = "#2E6BFF";
const GLOW_SOFT = "#4C8DFF";

export default function OpeningScreen() {
  const router = useRouter();
  const { user, ready } = useAuth();

  const glow = useSharedValue(0.35);
  const drift = useSharedValue(0);

  useEffect(() => {
    glow.value = withRepeat(withSequence(
      withTiming(0.75, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      withTiming(0.35, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
    ), -1, false);
    drift.value = withRepeat(withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [glow, drift]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -12 + drift.value * 24 }] }));

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (user) router.replace(user.onboarded ? "/(tabs)" : "/onboarding/sports");
      else router.replace("/auth");
    }, 2000);
    return () => clearTimeout(t);
  }, [ready, user, router]);

  return (
    <View style={styles.root} testID="opening-screen">
      <LinearGradient colors={[NAVY_DEEP, NAVY, NAVY_MID]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      {/* Animated radial glow behind the wordmark */}
      <Animated.View style={[styles.glowWrap, glowStyle, driftStyle]} pointerEvents="none">
        <LinearGradient
          colors={[GLOW + "55", GLOW + "18", "transparent"]}
          start={{ x: 0.5, y: 0.5 }} end={{ x: 1, y: 1 }}
          style={styles.glowCircle}
        />
      </Animated.View>

      {/* subtle top-right accent beam */}
      <LinearGradient colors={[GLOW_SOFT + "22", "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.3, y: 0.6 }} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <Animated.View entering={FadeInDown.delay(120).duration(600)}>
            <Text style={styles.smallBrand}>ATHLERA</Text>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(240).duration(600)}>
            <View style={styles.divider} />
          </Animated.View>
        </View>

        <View style={styles.center}>
          <Animated.View entering={FadeIn.delay(320).duration(800)} style={styles.logoWrap}>
            <Text style={styles.logo}>ATHLERA</Text>
            <View style={styles.logoBar} />
            <Text style={styles.tagline}>ERA OF THE ATHLETE</Text>
          </Animated.View>
        </View>

        <View style={styles.bottom}>
          <Animated.View entering={FadeIn.delay(700).duration(600)} style={styles.dots}>
            <Dot delay={0} /><Dot delay={200} /><Dot delay={400} />
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    const id = setTimeout(() => {
      v.value = withRepeat(withSequence(
        withTiming(1, { duration: 500 }), withTiming(0.3, { duration: 500 }),
      ), -1, false);
    }, delay);
    return () => clearTimeout(id);
  }, [v, delay]);
  const s = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[styles.dot, s]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY_MID },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  glowWrap: { position: "absolute", top: "28%", left: 0, right: 0, alignItems: "center" },
  glowCircle: { width: 420, height: 420, borderRadius: 210 },
  top: { alignItems: "center", paddingTop: spacing.lg, gap: spacing.sm },
  smallBrand: { ...font.textBold, letterSpacing: 6, fontSize: 12, color: "#8FA6E8" },
  divider: { width: 48, height: 2, backgroundColor: GLOW_SOFT },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  logoWrap: { alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  logo: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 76, lineHeight: 80, color: "#FFFFFF", letterSpacing: 5, textShadowColor: GLOW + "AA", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 24 },
  logoBar: { marginTop: spacing.sm, height: 4, width: 92, backgroundColor: GLOW_SOFT, borderRadius: radius.sm },
  tagline: { marginTop: spacing.md, ...font.textMedium, fontSize: 13, letterSpacing: 8, color: "#AEC1F0" },
  bottom: { alignItems: "center", paddingBottom: spacing.lg },
  dots: { flexDirection: "row", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: GLOW_SOFT },
});
