import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { storage } from "@/src/utils/storage";
import { cacheGet, cacheSet } from "@/src/utils/cache";
import CelebrationBanner, { CelebrationKind } from "@/src/components/CelebrationBanner";
import ProgressBar from "@/src/components/ProgressBar";

const ALL_SPORT_META = [
  { id: "squash", name: "Squash", decimals: 0, default_rating: 3500 },
  { id: "tennis", name: "Tennis", decimals: 2, default_rating: 3.5 },
  { id: "padel", name: "Padel", decimals: 2, default_rating: 3.5 },
  { id: "badminton", name: "Badminton", decimals: 0, default_rating: 500 },
  { id: "pickleball", name: "Pickleball", decimals: 2, default_rating: 3.5 },
];

export default function DashboardScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [data, setData] = useState<any>(() => cacheGet("dashboard") ?? null);
  const [loading, setLoading] = useState(() => !cacheGet("dashboard"));
  const [refreshing, setRefreshing] = useState(false);
  const [celebration, setCelebration] = useState<{ kind: CelebrationKind; message: string } | null>(null);

  const maybeCelebrate = useCallback(async (g: any) => {
    if (!g) return;
    let pick: { kind: CelebrationKind; message: string } | null = null;
    if (g.titles > 0) pick = { kind: "competition_win", message: `You've won ${g.titles} competition${g.titles > 1 ? "s" : ""}. Legendary.` };
    else if (g.current_streak >= 3) pick = { kind: "streak", message: `${g.current_streak} wins in a row. Keep the fire going!` };
    else if ((g.personal_bests || []).some((p: any) => p.at_peak)) pick = { kind: "personal_best", message: "You're sitting at a career-high rating. New personal best!" };
    else if (g.matches_this_week >= 3) pick = { kind: "keep_it_up", message: `${g.matches_this_week} matches this week. Great consistency!` };
    if (!pick) return;
    const sig = `${pick.kind}:${g.titles}:${g.best_rank}:${g.current_streak}:${g.matches_this_week}`;
    const seen = await storage.getItem("athlera_celebration_sig", "");
    if (seen === sig) return;
    await storage.setItem("athlera_celebration_sig", sig);
    setCelebration(pick);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboard();
      setData(d);
      cacheSet("dashboard", d);
      maybeCelebrate(d.gamification);
    } catch (e) {
      // If unauth, kick back to auth
      if ((e as any)?.status === 401) router.replace("/auth");
    } finally { setLoading(false); setRefreshing(false); }
  }, [router, maybeCelebrate]);

  // Revalidate on focus without a blank screen (cache seeds initial state).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const cards = data?.cards ?? [];

  return (
    <View style={styles.root} testID="dashboard-screen">
      <LinearGradient
        colors={["#0A1A4D", "#0A0E27", "#070A1C"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[colors.brand + "22", "transparent"]}
        start={{ x: 0.9, y: 0 }}
        end={{ x: 0.2, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top"]}>
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

        {celebration && (
          <CelebrationBanner kind={celebration.kind} message={celebration.message} onDone={() => setCelebration(null)} />
        )}

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

        {/* Gamification strip */}
        {(() => {
          const g = data?.gamification;
          if (!g) return null;
          return (
            <Animated.View entering={FadeInDown.delay(120).duration(500)} testID="gamify-strip">
              <View style={styles.gamRow}>
                <View style={styles.gamStat}>
                  <View style={styles.gamStatHead}><Ionicons name="flame" size={14} color="#FF6B4A" /><Text style={styles.gamStatValue}>{g.current_streak}</Text></View>
                  <Text style={styles.gamStatLabel}>STREAK</Text>
                </View>
                <View style={styles.gamStat}>
                  <View style={styles.gamStatHead}><Ionicons name="calendar" size={13} color={colors.brand} /><Text style={styles.gamStatValue}>{g.matches_this_week}</Text></View>
                  <Text style={styles.gamStatLabel}>THIS WEEK</Text>
                </View>
                <View style={styles.gamStat}>
                  <View style={styles.gamStatHead}><Ionicons name="ribbon" size={13} color="#00FA9A" /><Text style={styles.gamStatValue}>{g.longest_streak}</Text></View>
                  <Text style={styles.gamStatLabel}>LONGEST</Text>
                </View>
              </View>

              {g.recent_form?.length > 0 && (
                <View style={styles.formRow}>
                  <Text style={styles.formLabel}>RECENT FORM</Text>
                  <View style={styles.formPills}>
                    {g.recent_form.map((r: string, i: number) => (
                      <View key={i} style={[styles.formPill, { backgroundColor: r === "W" ? colors.success : colors.error }]}>
                        <Text style={styles.formPillText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {g.badges?.length > 0 && (
                <View style={styles.badgeStrip}>
                  {g.badges.map((b: any) => (
                    <View key={b.id} style={styles.badgeChip} testID={`badge-${b.id}`}>
                      <Ionicons name={b.icon} size={13} color={colors.brandSecondary} />
                      <Text style={styles.badgeChipText}>{b.label.toUpperCase()}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Next milestone + competition progress */}
              {(g.next_milestone || g.competition_progress || g.rating_change_week !== 0) && (
                <View style={styles.milestoneCard} testID="milestone-card">
                  {g.next_milestone && (
                    <View style={{ gap: 6 }}>
                      <View style={styles.milestoneHead}>
                        <View style={styles.milestoneHeadLeft}>
                          <Ionicons name="flag" size={13} color={sportAccent(g.next_milestone.sport_id)} />
                          <Text style={styles.milestoneTitle}>{g.next_milestone.label.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.milestoneSport}>{g.next_milestone.sport_name.toUpperCase()}</Text>
                      </View>
                      <ProgressBar progress={g.next_milestone.progress} color={sportAccent(g.next_milestone.sport_id)} />
                    </View>
                  )}
                  <View style={styles.milestoneFoot}>
                    {g.competition_progress && (
                      <View style={styles.progPill} testID="competition-progress">
                        <Ionicons name="git-branch" size={12} color={colors.brand} />
                        <Text style={styles.progPillText} numberOfLines={1}>{g.competition_progress.name}: {g.competition_progress.label}</Text>
                      </View>
                    )}
                    {g.rating_change_week !== 0 && (
                      <View style={[styles.progPill, { borderColor: g.rating_change_week >= 0 ? colors.success : colors.error }]} testID="rating-week">
                        <Ionicons name={g.rating_change_week >= 0 ? "trending-up" : "trending-down"} size={12} color={g.rating_change_week >= 0 ? colors.success : colors.error} />
                        <Text style={[styles.progPillText, { color: g.rating_change_week >= 0 ? colors.success : colors.error }]}>{g.rating_change_week >= 0 ? "+" : ""}{g.rating_change_week} this week</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </Animated.View>
          );
        })()}

        {/* Sport Cards — always show all five ATHLERA sports */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MY SPORTS</Text>
          <View style={styles.sectionLine} />
        </View>
        {ALL_SPORT_META.map((meta, i) => {
          const owned = cards.find((c: any) => c.sport_id === meta.id);
          const accent = sportAccent(meta.id);
          return (
            <Animated.View key={meta.id} entering={FadeInDown.delay(100 + i * 70).duration(400)}>
              <Pressable
                testID={`sport-card-${meta.id}`}
                onPress={() => router.push(`/sport/${meta.id}`)}
                style={({ pressed }) => [styles.sportCard, { borderLeftColor: accent }, pressed && { opacity: 0.85 }]}
              >
                {owned ? (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sportCardName, { color: accent }]}>{owned.sport_name.toUpperCase()}</Text>
                      <View style={styles.sportCardBadgeRow}>
                        {owned.provisional && (
                          <View style={styles.provisionalBadge}><Text style={styles.provisionalBadgeText}>PROVISIONAL</Text></View>
                        )}
                        <View style={styles.bandBadge}><Text style={styles.bandBadgeText}>{owned.band.toUpperCase()}</Text></View>
                      </View>
                      <Text style={styles.sportCardMeta}>
                        Rank #{owned.rank} · Peak {formatRating(owned.peak_rating, owned.decimals)} · {owned.matches_played} matches
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.sportCardRating}>{formatRating(owned.rating, owned.decimals)}</Text>
                      <Text style={styles.sportCardPctl}>{Math.round(owned.percentile * 100)}th pctl</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sportCardName, { color: accent }]}>{meta.name.toUpperCase()}</Text>
                      <View style={styles.sportCardBadgeRow}>
                        <View style={styles.startBadge}><Text style={styles.startBadgeText}>NOT STARTED</Text></View>
                      </View>
                      <Text style={styles.sportCardMeta}>Play a match to get your provisional rating</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.startRating}>{formatRating(meta.default_rating, meta.decimals)}</Text>
                      <Text style={styles.startCta}>START RATING →</Text>
                    </View>
                  </>
                )}
              </Pressable>
            </Animated.View>
          );
        })}
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  safe: { flex: 1 },
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
  gamRow: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.md },
  gamStat: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 4 },
  gamStatHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  gamStatValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  gamStatLabel: { ...font.textBold, letterSpacing: 1, fontSize: 8, color: colors.onSurfaceTertiary },
  formRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm },
  formLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurfaceSecondary },
  formPills: { flexDirection: "row", gap: 4 },
  formPill: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  formPillText: { ...font.textBold, fontSize: 11, color: "#0B0D12" },
  badgeStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: spacing.md, marginTop: spacing.sm },
  badgeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.surfaceTertiary },
  badgeChipText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.brandSecondary },
  milestoneCard: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  milestoneHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  milestoneHeadLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  milestoneTitle: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurface },
  milestoneSport: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  milestoneFoot: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  progPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5, maxWidth: "100%" },
  progPillText: { ...font.textMedium, fontSize: 11, color: colors.onSurfaceSecondary, flexShrink: 1 },
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
  startBadge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  startBadgeText: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceTertiary },
  startRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurfaceTertiary },
  startCta: { ...font.textBold, fontSize: 9, letterSpacing: 1, color: colors.brand, marginTop: 2 },
  bandBadge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  bandBadgeText: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceSecondary },
  sportCardMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6 },
  sportCardRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  sportCardPctl: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary },
  emptyState: { padding: spacing.lg, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 4 },
});
