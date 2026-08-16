import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { colors, spacing, font, radius } from "@/src/theme";
import { useAuth } from "@/src/auth-context";

const HERO_BG = "https://images.pexels.com/photos/30566478/pexels-photo-30566478.jpeg";

export default function OpeningScreen() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    // If already logged-in & onboarded → straight to app. If logged-in but not
    // onboarded → onboarding. Otherwise stay here waiting for a tap.
    if (!ready) return;
    // We don't auto-redirect; the user must tap the logo on their first launch
    // per the spec — but if they were mid-onboarding we push them there.
  }, [ready, user, router]);

  const onEnter = async () => {
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    if (user) {
      router.replace(user.onboarded ? "/(tabs)" : "/onboarding/sports");
    } else {
      router.push("/auth");
    }
  };

  return (
    <View style={styles.root} testID="opening-screen">
      <Image source={HERO_BG} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={["rgba(11,13,18,0.55)", "rgba(11,13,18,0.85)", "#0B0D12"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
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
          <Animated.View entering={FadeIn.delay(360).duration(700)}>
            <Pressable
              testID="logo-enter-button"
              onPress={onEnter}
              hitSlop={24}
              style={({ pressed }) => [styles.logoWrap, pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] }]}
            >
              <Text style={styles.logo}>ATHLERA</Text>
              <View style={styles.logoBar} />
              <Text style={styles.tagline}>ERA OF THE ATHLETE</Text>
            </Pressable>
          </Animated.View>
        </View>

        <View style={styles.bottom}>
          {!ready ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <Animated.View entering={FadeInDown.delay(720).duration(600)}>
              <Pressable
                testID="opening-tap-to-enter"
                onPress={onEnter}
                style={({ pressed }) => [styles.tapCta, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.tapCtaText}>TAP LOGO TO ENTER</Text>
                <View style={styles.tapCtaLine} />
              </Pressable>
            </Animated.View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  top: { alignItems: "center", paddingTop: spacing.lg, gap: spacing.sm },
  smallBrand: {
    ...font.textBold,
    letterSpacing: 6,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
  },
  divider: { width: 48, height: 2, backgroundColor: colors.brand },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  logoWrap: { alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  logo: {
    ...font.display,
    fontFamily: "BarlowCondensed",
    fontSize: 68,
    lineHeight: 72,
    color: colors.onSurface,
    letterSpacing: 4,
  },
  logoBar: { marginTop: spacing.sm, height: 4, width: 80, backgroundColor: colors.brand, borderRadius: radius.sm },
  tagline: {
    marginTop: spacing.md,
    ...font.textMedium,
    fontSize: 13,
    letterSpacing: 8,
    color: colors.onSurfaceSecondary,
  },
  bottom: { alignItems: "center", paddingBottom: spacing.lg, gap: spacing.md },
  tapCta: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  tapCtaText: {
    ...font.textBold,
    letterSpacing: 4,
    fontSize: 12,
    color: colors.onSurface,
  },
  tapCtaLine: { height: 2, width: 32, backgroundColor: colors.brand },
});
