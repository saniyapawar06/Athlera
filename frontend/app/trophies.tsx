import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font } from "@/src/theme";
import { api } from "@/src/api";
import { AchievementBadge } from "@/src/components/AchievementBadge";
import { CATEGORY_LABELS, CATEGORY_ORDER, Achievement } from "@/src/gamification";

export default function TrophiesScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.achievements()); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const grouped = useMemo(() => {
    const catalog: any[] = data?.catalog ?? [];
    const unlocked: Achievement[] = data?.unlocked ?? [];
    // For sport-scoped codes a user may hold multiple (per sport). Merge by category.
    const unlockedByCode = new Map<string, Achievement[]>();
    unlocked.forEach((u) => {
      const arr = unlockedByCode.get(u.code) || [];
      arr.push(u);
      unlockedByCode.set(u.code, arr);
    });
    const map: Record<string, any[]> = {};
    catalog.forEach((c) => {
      const holds = unlockedByCode.get(c.code);
      const item = holds && holds.length
        ? { ...c, ...holds[0], unlocked: true, count: holds.length }
        : { ...c, unlocked: false };
      (map[c.category] = map[c.category] || []).push(item);
    });
    return map;
  }, [data]);

  const unlockedCount = data?.unlocked_count ?? 0;
  const total = data?.total ?? 0;
  const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="trophies-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="trophies-back-btn" style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>TROPHY ROOM</Text>
      </View>

      {loading && !data ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          <View style={styles.progressCard} testID="trophy-progress">
            <View style={{ flex: 1 }}>
              <Text style={styles.progressLabel}>ACHIEVEMENTS EARNED</Text>
              <Text style={styles.progressValue}>{unlockedCount}<Text style={styles.progressMax}> / {total}</Text></Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
            </View>
            <View style={styles.progressPct}>
              <Ionicons name="trophy" size={22} color={colors.brand} />
              <Text style={styles.progressPctText}>{pct}%</Text>
            </View>
          </View>

          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat, ci) => (
            <Animated.View key={cat} entering={FadeInDown.delay(80 + ci * 60).duration(400)} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{(CATEGORY_LABELS[cat] || cat).toUpperCase()}</Text>
                <View style={styles.sectionLine} />
                <Text style={styles.sectionCount}>
                  {grouped[cat].filter((x: any) => x.unlocked).length}/{grouped[cat].length}
                </Text>
              </View>
              <View style={styles.grid}>
                {grouped[cat].map((a: any) => (
                  <AchievementBadge key={a.code} achievement={a} locked={!a.unlocked} />
                ))}
              </View>
            </Animated.View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  headerTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface, letterSpacing: 2 },
  scroll: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  progressCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.brand, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  progressLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  progressValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 44, color: colors.onSurface },
  progressMax: { ...font.text, fontSize: 16, color: colors.onSurfaceTertiary },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, marginTop: 4, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },
  progressPct: { alignItems: "center", gap: 2 },
  progressPctText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  sectionCount: { ...font.textBold, fontSize: 11, color: colors.onSurfaceTertiary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
