import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";

export default function OnboardingSummaryScreen() {
  const router = useRouter();
  const { ratings } = useLocalSearchParams<{ ratings: string }>();
  let parsed: any[] = [];
  try { parsed = JSON.parse(ratings || "[]"); } catch { parsed = []; }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-summary-screen">
      <View style={styles.header}>
        <Animated.Text entering={FadeIn.duration(400)} style={styles.eyebrow}>PROVISIONAL RATINGS GENERATED</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(100).duration(400)} style={styles.title}>YOU&apos;RE IN</Animated.Text>
        <Text style={styles.subtitle}>These calibrate quickly over your first five verified matches. Play matches to remove the provisional flag.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {parsed.map((r, i) => {
          const accent = sportAccent(r.sport_id);
          return (
            <Animated.View
              key={r.sport_id}
              entering={FadeInDown.delay(150 + i * 100).duration(500)}
              style={[styles.card, { borderLeftColor: accent }]}
              testID={`summary-card-${r.sport_id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sportName, { color: accent }]}>{r.sport_name.toUpperCase()}</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.badge}><Text style={styles.badgeText}>PROVISIONAL</Text></View>
                  {r.external && (
                    <View style={[styles.badge, { borderColor: colors.warning }]}>
                      <Text style={[styles.badgeText, { color: colors.warning }]}>VERIFICATION PENDING</Text>
                    </View>
                  )}
                </View>
              </View>
              <Text style={styles.ratingValue}>{formatRating(r.rating, r.decimals)}</Text>
            </Animated.View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          testID="summary-enter-btn"
          onPress={() => router.replace("/(tabs)")}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>ENTER ATHLERA →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 8 },
  eyebrow: { ...font.textBold, fontSize: 10, letterSpacing: 3, color: colors.brand },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 48, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 20 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 4, backgroundColor: colors.surfaceSecondary,
  },
  sportName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, letterSpacing: 2 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  badge: { borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceSecondary },
  ratingValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 38, color: colors.onSurface },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md },
  cta: { backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
});
