import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "overview" | "leaderboard" | "scores" | "competitions";

export default function SportDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = id as string;
  const accent = sportAccent(sid);
  const [data, setData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [comps, setComps] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, h, c, m] = await Promise.all([
        api.sportPage(sid), api.ratingHistory(sid), api.compList(sid), api.matchHistory({ sport_id: sid }),
      ]);
      setData(d); setHistory(h.history || []); setComps(c.competitions || []); setMatches(m.matches || []);
    } finally { setLoading(false); }
  }, [sid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return <SafeAreaView style={styles.root} edges={["top"]}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  const p = data.player;
  const dec = data.sport.decimals;
  const wins = p?.wins ?? 0, played = p?.matches_played ?? 0;
  const losses = played - wins;
  const winPct = played > 0 ? Math.round((wins / played) * 100) : 0;
  const form: string[] = p?.recent_form || [];
  const streak = p?.current_streak || 0;

  const hVals = history.map((h) => h.after);
  const hMin = Math.min(...hVals, p?.rating ?? 0), hMax = Math.max(...hVals, p?.rating ?? 1);

  const ACTIONS = [
    { key: "record", label: "Record Result", icon: "create-outline", onPress: () => router.push("/(tabs)/score") },
    { key: "live", label: "Start Live Score", icon: "radio-outline", onPress: () => router.push(`/live/setup?sport_id=${sid}`) },
    { key: "league", label: "Create League", icon: "list-outline", onPress: () => router.push(`/competition/create?sport_id=${sid}&type=league`) },
    { key: "knockout", label: "Create Knockout", icon: "git-network-outline", onPress: () => router.push(`/competition/create?sport_id=${sid}&type=knockout`) },
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="sport-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="sport-back-btn" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.sportTitle, { color: accent }]}>{data.sport.name.toUpperCase()}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[1]}>
        {/* HERO */}
        <View style={styles.heroWrap}>
          <LinearGradient colors={[accent + "22", "transparent"]} style={StyleSheet.absoluteFill} />
          <View style={[styles.heroCard, { borderLeftColor: accent }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>YOUR RATING</Text>
              <Text style={styles.heroRating}>{p ? formatRating(p.rating, dec) : "—"}</Text>
              <View style={styles.badgeRow}>
                {p?.provisional && <View style={styles.provBadge}><Text style={styles.provBadgeText}>PROVISIONAL</Text></View>}
                {data.my_rank && <View style={styles.rankBadge}><Text style={styles.rankBadgeText}>RANK #{data.my_rank}</Text></View>}
                {streak !== 0 && <View style={[styles.rankBadge, { borderColor: streak > 0 ? colors.success : colors.error }]}><Text style={[styles.rankBadgeText, { color: streak > 0 ? colors.success : colors.error }]}>{streak > 0 ? `W${streak}` : `L${-streak}`} STREAK</Text></View>}
              </View>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.heroPeakLabel}>PEAK</Text>
              <Text style={styles.heroPeak}>{p ? formatRating(p.peak_rating, dec) : "—"}</Text>
              <View style={styles.formRow}>
                {form.slice(-5).map((f, i) => (
                  <View key={i} style={[styles.formDot, { backgroundColor: f === "W" ? colors.success : colors.error }]}><Text style={styles.formDotText}>{f}</Text></View>
                ))}
              </View>
            </View>
          </View>

          {/* ACTIONS */}
          <View style={styles.actionsGrid}>
            {ACTIONS.map((a) => (
              <Pressable key={a.key} testID={`action-${a.key}`} onPress={a.onPress} style={({ pressed }) => [styles.actionBtn, pressed && { backgroundColor: colors.surfaceTertiary, borderColor: accent }]}>
                <Ionicons name={a.icon as any} size={20} color={accent} />
                <Text style={styles.actionText}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* STICKY TABS */}
        <View style={styles.tabs}>
          {(["overview", "leaderboard", "scores", "competitions"] as Tab[]).map((t) => (
            <Pressable key={t} testID={`sport-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: accent }]}>
              <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]}>{t.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ padding: spacing.md }}>
          {tab === "overview" && (
            <View style={{ gap: spacing.md }}>
              <View style={styles.statGrid}>
                {[{ l: "MATCHES", v: played }, { l: "WINS", v: wins }, { l: "LOSSES", v: losses }, { l: "WIN %", v: `${winPct}%` }].map((s) => (
                  <View key={s.l} style={styles.statBox}><Text style={styles.statValue}>{s.v}</Text><Text style={styles.statLabel}>{s.l}</Text></View>
                ))}
              </View>
              <Text style={styles.sectionTitle}>RATING HISTORY</Text>
              {history.length === 0 ? <Text style={styles.hint}>Play matches to build your rating trend.</Text> : (
                <View style={styles.chart}>
                  {history.slice(-24).map((h, i) => {
                    const t = hMax === hMin ? 0.5 : (h.after - hMin) / (hMax - hMin);
                    return <View key={i} style={[styles.bar, { height: 10 + t * 90, backgroundColor: h.delta >= 0 ? accent : colors.error }]} />;
                  })}
                </View>
              )}
            </View>
          )}

          {tab === "leaderboard" && (
            <View style={{ gap: spacing.sm }}>
              {data.leaderboard.map((r: any) => (
                <Pressable key={r.user_id} testID={`sport-lb-row-${r.rank}`} onPress={() => router.push(`/athlete/${r.user_id}`)} style={[styles.lbRow, r.is_me && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={[styles.lbRank, r.rank <= 3 && { color: accent }]}>{r.rank}</Text>
                  <View style={{ flex: 1 }}><Text style={styles.lbName} numberOfLines={1}>{r.display_name}{r.is_me ? " (You)" : ""}</Text><Text style={styles.lbCity}>{r.city || "—"}{r.provisional ? " · Provisional" : ""}</Text></View>
                  <Text style={styles.lbRating}>{formatRating(r.rating, dec)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {tab === "scores" && (
            <View style={{ gap: spacing.sm }}>
              {matches.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No matches yet</Text><Text style={styles.emptySub}>Record or live-score a match.</Text></View> :
                matches.map((m) => (
                  <View key={m.id} style={styles.matchRow} testID={`match-row-${m.id}`}>
                    <View style={[styles.wl, { backgroundColor: m.won ? colors.success : colors.error }]}><Text style={styles.wlText}>{m.won ? "W" : "L"}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matchOpp}>vs {m.opponent_name}</Text>
                      <Text style={styles.matchScore}>{(m.games || []).map((g: number[]) => `${g[0]}-${g[1]}`).join("  ")}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      {m.rating_delta != null && <Text style={[styles.matchDelta, { color: m.rating_delta >= 0 ? colors.success : colors.error }]}>{m.rating_delta >= 0 ? "+" : ""}{m.rating_delta}</Text>}
                      <Text style={styles.matchSrc}>{(m.source || "manual").toUpperCase()}</Text>
                    </View>
                  </View>
                ))}
              <Pressable testID="view-all-history" onPress={() => router.push(`/match-history?sport_id=${sid}`)} style={styles.linkBtn}><Text style={styles.linkText}>VIEW FULL HISTORY & FILTERS →</Text></Pressable>
            </View>
          )}

          {tab === "competitions" && (
            <View style={{ gap: spacing.sm }}>
              {comps.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No competitions</Text><Text style={styles.emptySub}>Create a league or knockout above.</Text></View> :
                comps.map((c) => (
                  <Pressable key={c.id} testID={`comp-card-${c.id}`} onPress={() => router.push(`/competition/${c.id}`)} style={styles.compRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.compName}>{c.name}</Text>
                      <Text style={styles.compMeta}>{c.type.toUpperCase()} · {c.city || "—"} · {c.member_count} players · {c.status.replace("_", " ")}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                  </Pressable>
                ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  sportTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, letterSpacing: 2 },
  scroll: { paddingBottom: spacing.xxl },
  heroWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  heroCard: { flexDirection: "row", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  heroLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  heroRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 56, color: colors.onSurface, lineHeight: 58 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  provBadge: { borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  provBadgeText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.warning },
  rankBadge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  rankBadgeText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceSecondary },
  heroPeakLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceTertiary },
  heroPeak: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  formRow: { flexDirection: "row", gap: 4, marginTop: 8 },
  formDot: { width: 18, height: 18, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  formDotText: { ...font.textBold, fontSize: 10, color: "#0B0D12" },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionBtn: { width: "47.8%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  actionText: { ...font.textBold, letterSpacing: 0.5, fontSize: 12, color: colors.onSurface, flexShrink: 1 },
  tabs: { flexDirection: "row", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 0.5, fontSize: 10, color: colors.onSurfaceTertiary },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statBox: { width: "47.5%", flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  statValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, color: colors.onSurface },
  statLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  sectionTitle: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 110, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  bar: { flex: 1, borderRadius: 2, minWidth: 3 },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  lbRank: { width: 30, ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, textAlign: "center" },
  lbName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  lbCity: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  lbRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface },
  matchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  wl: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  wlText: { ...font.textBold, fontSize: 14, color: "#0B0D12" },
  matchOpp: { ...font.textBold, fontSize: 13, color: colors.onSurface },
  matchScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  matchDelta: { ...font.textBold, fontSize: 15 },
  matchSrc: { ...font.textBold, letterSpacing: 1, fontSize: 8, color: colors.onSurfaceTertiary },
  linkBtn: { padding: spacing.md, alignItems: "center" },
  linkText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.brand },
  compRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  compMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
});
