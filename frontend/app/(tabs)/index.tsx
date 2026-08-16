import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { toneColor, tierColor } from "@/src/gamification";

export default function DashboardScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboard();
      setData(d);
    } catch (e) {
      if ((e as any)?.status === 401) router.replace("/auth");
    } finally { setLoading(false); setRefreshing(false); }
  }, [router]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const cards = data?.cards ?? [];
  const recent = data?.recent_achievements ?? [];
  const achCount = data?.achievement_count ?? 0;
  const achTotal = data?.achievement_total ?? 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>WELCOME BACK</Text>
            <Text style={styles.name} numberOfLines={1}>{user?.display_name || "Athlete"}</Text>
          </View>
          <Pressable onPress={() => router.push("/trophies")} testID="header-trophies-btn" style={styles.iconBtn}>
            <Ionicons name="trophy-outline" size={24} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push("/profile")} testID="header-profile-btn" style={styles.iconBtn}>
            <Ionicons name="person-circle-outline" size={28} color={colors.onSurface} />
          </Pressable>
          <Pressable onPress={logout} testID="header-logout-btn" style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={24} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>

        {/* UAS Hero */}
        <Animated.View entering={FadeInDown.duration(500)} style={styles.uasCard} testID="uas-hero">
          <Text style={styles.uasLabel}>UNIVERSAL ATHLETE SCORE</Text>
          <View style={styles.uasRow}>
            <Text style={styles.uasNumber}>{data?.uas ?? 0}</Text>
            <Text style={styles.uasOutOf}>/ 1000</Text>
          </View>
          <View style={styles.uasMeta}>
            <View style={styles.uasStat}>
              <Text style={styles.uasStatValue}>{data?.sports_counted ?? 0}</Text>
              <Text style={styles.uasStatLabel}>SPORTS</Text>
            </View>
            <View style={styles.uasStatDivider} />
            <View style={styles.uasStat}>
              <Text style={styles.uasStatValue}>{data?.total_matches ?? 0}</Text>
              <Text style={styles.uasStatLabel}>MATCHES</Text>
            </View>
            <View style={styles.uasStatDivider} />
            <View style={styles.uasStat}>
              <Text style={styles.uasStatValue}>{achCount}</Text>
              <Text style={styles.uasStatLabel}>TROPHIES</Text>
            </View>
          </View>
        </Animated.View>

        {/* Momentum / Trophy strip */}
        <Pressable onPress={() => router.push("/trophies")} testID="momentum-strip" style={styles.momentumHeader}>
          <Text style={styles.sectionTitle}>MOMENTUM</Text>
          <View style={styles.sectionLine} />
          <Text style={styles.momentumLink}>TROPHY ROOM →</Text>
        </Pressable>
        {recent.length === 0 ? (
          <View style={styles.momentumEmpty}>
            <Ionicons name="ribbon-outline" size={18} color={colors.onSurfaceTertiary} />
            <Text style={styles.momentumEmptyText}>Win matches to earn your first trophy · {achCount}/{achTotal}</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.momentumScroll}>
            {recent.map((a: any) => (
              <Pressable key={a.code + (a.sport_id || "")} onPress={() => router.push("/trophies")} style={[styles.momentumChip, { borderColor: tierColor(a.tier) + "AA" }]} testID={`momentum-${a.code}`}>
                <View style={[styles.momentumIcon, { borderColor: tierColor(a.tier) }]}>
                  <Ionicons name={a.icon as any} size={16} color={tierColor(a.tier)} />
                </View>
                <Text style={styles.momentumTitle} numberOfLines={1}>{a.title}</Text>
                {a.sport_name ? <Text style={styles.momentumSport} numberOfLines={1}>{a.sport_name}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Sport Cards */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MY SPORTS</Text>
          <View style={styles.sectionLine} />
        </View>
        {cards.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No sports yet</Text>
            <Text style={styles.emptySub}>Add a sport from your profile to start rating.</Text>
          </View>
        ) : cards.map((c: any, i: number) => (
          <Animated.View key={c.sport_id} entering={FadeInDown.delay(100 + i * 80).duration(400)} style={styles.cardWrap}>
            <Pressable
              testID={`sport-card-${c.sport_id}`}
              onPress={() => router.push(`/sport/${c.sport_id}`)}
              style={({ pressed }) => [styles.sportCard, { borderLeftColor: c.accent }, pressed && { opacity: 0.85 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sportCardName, { color: c.accent }]}>{c.sport_name.toUpperCase()}</Text>
                <View style={styles.sportCardBadgeRow}>
                  {c.provisional && (
                    <View style={styles.provisionalBadge}>
                      <Text style={styles.provisionalBadgeText}>PROVISIONAL</Text>
                    </View>
                  )}
                  <View style={styles.bandBadge}>
                    <Text style={styles.bandBadgeText}>{c.band.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.sportCardMeta}>
                  Rank #{c.rank} · Peak {formatRating(c.peak_rating, c.decimals)} · {c.matches_played} matches
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.sportCardRating}>{formatRating(c.rating, c.decimals)}</Text>
                <Text style={styles.sportCardPctl}>{Math.round(c.percentile * 100)}th pctl</Text>
              </View>
            </Pressable>

            {/* Insights */}
            {(c.insights ?? []).length > 0 && (
              <View style={styles.insightsRow} testID={`insights-${c.sport_id}`}>
                {c.insights.slice(0, 4).map((ins: any, idx: number) => (
                  <View key={idx} style={[styles.insightPill, { borderColor: toneColor(ins.tone) + "66" }]}>
                    <Ionicons name={ins.icon as any} size={12} color={toneColor(ins.tone)} />
                    <Text style={[styles.insightText, { color: toneColor(ins.tone) }]}>{ins.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.xs },
  hello: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.brand },
  name: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  iconBtn: { padding: 4 },
  uasCard: {
    marginHorizontal: spacing.md, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    borderLeftWidth: 4, borderLeftColor: colors.brand, gap: spacing.sm,
  },
  uasLabel: { ...font.textBold, letterSpacing: 3, fontSize: 10, color: colors.onSurfaceSecondary },
  uasRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  uasNumber: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 72, color: colors.onSurface, lineHeight: 72 },
  uasOutOf: { ...font.text, color: colors.onSurfaceTertiary, fontSize: 16 },
  uasMeta: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm, gap: spacing.md },
  uasStat: { flex: 1 },
  uasStatValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface },
  uasStatLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurfaceTertiary },
  uasStatDivider: { width: 1, height: 32, backgroundColor: colors.border },
  momentumHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  momentumLink: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.brand },
  momentumScroll: { paddingHorizontal: spacing.md, gap: spacing.sm },
  momentumChip: { width: 128, gap: 4, padding: spacing.sm, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  momentumIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  momentumTitle: { ...font.textBold, fontSize: 12, color: colors.onSurface, marginTop: 2 },
  momentumSport: { ...font.text, fontSize: 10, color: colors.onSurfaceTertiary },
  momentumEmpty: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md },
  momentumEmptyText: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary, flex: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { ...font.textBold, letterSpacing: 3, fontSize: 11, color: colors.onSurfaceSecondary },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  cardWrap: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  sportCard: {
    flexDirection: "row", padding: spacing.md, gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4,
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  sportCardName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, letterSpacing: 2 },
  sportCardBadgeRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  provisionalBadge: { borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  provisionalBadgeText: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.warning },
  bandBadge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  bandBadgeText: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceSecondary },
  sportCardMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6 },
  sportCardRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  sportCardPctl: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary },
  insightsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  insightPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.surfaceSecondary },
  insightText: { ...font.textBold, fontSize: 11, letterSpacing: 0.2 },
  emptyState: { padding: spacing.lg, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
});
