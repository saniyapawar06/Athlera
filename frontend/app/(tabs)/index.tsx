import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

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
      // If unauth, kick back to auth
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
              <Text style={styles.uasStatValue}>{cards.length > 0 ? Math.max(...cards.map((c: any) => (c.percentile * 100 | 0))) : 0}%</Text>
              <Text style={styles.uasStatLabel}>TOP PCTL</Text>
            </View>
          </View>
        </Animated.View>

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
          <Animated.View key={c.sport_id} entering={FadeInDown.delay(100 + i * 80).duration(400)}>
            <Pressable
              testID={`sport-card-${c.sport_id}`}
              onPress={() => router.push(`/sport/${c.sport_id}`)}
              style={({ pressed }) => [
                styles.sportCard,
                { borderLeftColor: c.accent },
                pressed && { opacity: 0.85 },
              ]}
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
          </Animated.View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: spacing.xxl },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.sm },
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
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { ...font.textBold, letterSpacing: 3, fontSize: 11, color: colors.onSurfaceSecondary },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  sportCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm,
    flexDirection: "row", padding: spacing.md, gap: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
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
  emptyState: { padding: spacing.lg, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
});
