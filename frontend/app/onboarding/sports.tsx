import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

const SPORT_IMAGES: Record<string, string> = {
  tennis: "https://images.unsplash.com/photo-1545151414-8a948e1ea54f?crop=entropy&cs=srgb&fm=jpg&w=800&q=70",
  padel: "https://images.unsplash.com/photo-1508129214940-7b2223ae0a08?crop=entropy&cs=srgb&fm=jpg&w=800&q=70",
  squash: "https://images.pexels.com/photos/8007134/pexels-photo-8007134.jpeg?w=800",
  badminton: "https://images.pexels.com/photos/14605729/pexels-photo-14605729.jpeg?w=800",
  pickleball: "https://images.pexels.com/photos/29439346/pexels-photo-29439346.jpeg?w=800",
};

export default function OnboardingSportsScreen() {
  const router = useRouter();
  const [sports, setSports] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { sports } = await api.sports();
        setSports(sports);
      } finally { setLoading(false); }
    })();
  }, []);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const cont = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected).join(",");
    router.push({ pathname: "/onboarding/rating", params: { sports: ids } });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-sports-screen">
      <View style={styles.header}>
        <Text style={styles.step}>STEP 1 OF 2</Text>
        <Text style={styles.title}>Which sports do you play?</Text>
        <Text style={styles.subtitle}>Pick one or several — you can add more later.</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {sports.map((s, i) => {
          const accent = sportAccent(s.id);
          const isSelected = selected.has(s.id);
          return (
            <Animated.View key={s.id} entering={FadeInDown.delay(80 * i).duration(400)}>
              <Pressable
                testID={`sport-card-${s.id}`}
                onPress={() => toggle(s.id)}
                style={({ pressed }) => [
                  styles.card,
                  isSelected && { borderColor: accent, backgroundColor: colors.surfaceTertiary },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Image source={SPORT_IMAGES[s.id]} style={styles.cardImg} contentFit="cover" />
                <LinearGradient
                  colors={["rgba(11,13,18,0.3)", "rgba(11,13,18,0.9)"]}
                  locations={[0, 1]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.cardContent}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sportName, { color: accent }]}>{s.name.toUpperCase()}</Text>
                    <Text style={styles.sportMeta}>Rating scale · {s.decimals > 0 ? "decimal" : "integer"}</Text>
                  </View>
                  <View style={[styles.checkbox, isSelected && { backgroundColor: accent, borderColor: accent }]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.countText}>{selected.size} selected</Text>
        <Pressable
          testID="onboarding-continue-btn"
          onPress={cont}
          disabled={selected.size === 0}
          style={({ pressed }) => [
            styles.cta,
            selected.size === 0 && { opacity: 0.4 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.ctaText}>CONTINUE →</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: 6 },
  step: { ...font.textBold, fontSize: 10, letterSpacing: 3, color: colors.brand },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 1 },
  subtitle: { ...font.text, fontSize: 14, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    overflow: "hidden", height: 96, backgroundColor: colors.surfaceSecondary,
  },
  cardImg: { ...StyleSheet.absoluteFillObject },
  cardContent: {
    flex: 1, flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.md, gap: spacing.md,
  },
  sportName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, letterSpacing: 2 },
  sportMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  checkbox: {
    width: 28, height: 28, borderRadius: radius.sm, borderWidth: 2,
    borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  checkmark: { ...font.textBold, color: "#0B0D12", fontSize: 16 },
  footer: {
    borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface,
  },
  countText: { flex: 1, ...font.textBold, fontSize: 12, letterSpacing: 2, color: colors.onSurfaceSecondary },
  cta: { backgroundColor: colors.brand, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md },
  ctaText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
});
