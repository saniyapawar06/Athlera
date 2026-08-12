import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";

type Tab = "overview" | "leaderboard" | "scores";

export default function SportDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api.sportPage(id as string); setData(d); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const accent = sportAccent(id as string);

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} />
      </SafeAreaView>
    );
  }

  const p = data.player;
  const dec = data.sport.decimals;
  const wins = p?.wins ?? 0;
  const played = p?.matches_played ?? 0;
  const losses = played - wins;
  const winPct = played > 0 ? Math.round((wins / played) * 100) : 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="sport-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="sport-back-btn" style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.sportTitle, { color: accent }]}>{data.sport.name.toUpperCase()}</Text>
      </View>

      {p && (
        <View style={[styles.heroCard, { borderLeftColor: accent }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroLabel}>YOUR RATING</Text>
            <Text style={styles.heroRating}>{formatRating(p.rating, dec)}</Text>
            <View style={styles.badgeRow}>
              {p.provisional && <View style={styles.provBadge}><Text style={styles.provBadgeText}>PROVISIONAL</Text></View>}
              {data.my_rank && <View style={styles.rankBadge}><Text style={styles.rankBadgeText}>RANK #{data.my_rank}</Text></View>}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.heroPeakLabel}>PEAK</Text>
            <Text style={styles.heroPeak}>{formatRating(p.peak_rating, dec)}</Text>
          </View>
        </View>
      )}

      <View style={styles.tabs}>
        {(["overview", "leaderboard", "scores"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            testID={`sport-tab-${t}`}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && { borderBottomColor: accent }]}
          >
            <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === "overview" && (
          <View style={{ gap: spacing.md }}>
            <View style={styles.statGrid}>
              {[
                { l: "MATCHES", v: played },
                { l: "WINS", v: wins },
                { l: "LOSSES", v: losses },
                { l: "WIN %", v: `${winPct}%` },
              ].map((s) => (
                <View key={s.l} style={styles.statBox}>
                  <Text style={styles.statValue}>{s.v}</Text>
                  <Text style={styles.statLabel}>{s.l}</Text>
                </View>
              ))}
            </View>
            <Pressable testID="record-match-cta" onPress={() => router.push("/(tabs)/score")} style={[styles.cta, { backgroundColor: accent }]}>
              <Text style={styles.ctaText}>RECORD A MATCH</Text>
            </Pressable>
            {!p && <Text style={styles.hint}>You have no rating in this sport yet.</Text>}
          </View>
        )}

        {tab === "leaderboard" && (
          <View style={{ gap: spacing.sm }}>
            {data.leaderboard.map((r: any) => (
              <Pressable
                key={r.user_id}
                testID={`sport-lb-row-${r.rank}`}
                onPress={() => router.push(`/athlete/${r.user_id}`)}
                style={[styles.lbRow, r.is_me && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.lbRank, r.rank <= 3 && { color: accent }]}>{r.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lbName} numberOfLines={1}>{r.display_name}{r.is_me ? " (You)" : ""}</Text>
                  <Text style={styles.lbCity}>{r.city || "—"}{r.provisional ? " · Provisional" : ""}</Text>
                </View>
                <Text style={styles.lbRating}>{formatRating(r.rating, dec)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === "scores" && (
          <View style={{ gap: spacing.sm }}>
            {data.matches.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyTitle}>No matches yet</Text><Text style={styles.emptySub}>Record a result to build history.</Text></View>
            ) : data.matches.map((m: any) => (
              <View key={m.id} style={styles.matchRow} testID={`match-row-${m.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchScore}>{(m.games || []).map((g: number[]) => `${g[0]}-${g[1]}`).join("  ")}</Text>
                  <Text style={styles.matchMeta}>{m.status?.replace("_", " ").toUpperCase()}</Text>
                </View>
                {m.preview?.tag && <Text style={styles.matchTag}>{m.preview.tag}</Text>}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  backBtn: { padding: 4 },
  sportTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, letterSpacing: 2 },
  heroCard: { marginHorizontal: spacing.md, flexDirection: "row", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  heroLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  heroRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 56, color: colors.onSurface, lineHeight: 58 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  provBadge: { borderWidth: 1, borderColor: colors.warning, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  provBadgeText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.warning },
  rankBadge: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  rankBadgeText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceSecondary },
  heroPeakLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceTertiary },
  heroPeak: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface },
  tabs: { flexDirection: "row", marginTop: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 1.5, fontSize: 11, color: colors.onSurfaceTertiary },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statBox: { width: "47.5%", flexGrow: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  statValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, color: colors.onSurface },
  statLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  lbRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  lbRank: { width: 30, ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, textAlign: "center" },
  lbName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  lbCity: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  lbRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface },
  matchRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  matchScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  matchMeta: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 2 },
  matchTag: { ...font.textMedium, fontSize: 10, color: colors.brand, maxWidth: 120, textAlign: "right" },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
});
