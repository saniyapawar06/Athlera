import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

const TABS: { id: string; label: string }[] = [
  { id: "uas", label: "UAS" },
  { id: "squash", label: "SQUASH" },
  { id: "padel", label: "PADEL" },
  { id: "tennis", label: "TENNIS" },
  { id: "badminton", label: "BADMINTON" },
  { id: "pickleball", label: "PICKLEBALL" },
];

export default function RankingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [active, setActive] = useState("uas");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportMeta, setSportMeta] = useState<any | null>(null);

  const load = useCallback(async (tab: string) => {
    setLoading(true);
    try {
      if (tab === "uas") {
        const r = await api.rankingsUAS();
        setRows(r.rows || []); setSportMeta(null);
      } else {
        const r = await api.rankingsSport(tab);
        setRows(r.rows || []); setSportMeta(r.sport);
      }
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(active); }, [load, active]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="rankings-screen">
      <View style={styles.header}>
        <Text style={styles.title}>RANKINGS</Text>
        <Text style={styles.subtitle}>Global leaderboards · Universal & per-sport</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
          {TABS.map((t) => {
            const isActive = active === t.id;
            const accent = t.id === "uas" ? colors.brand : sportAccent(t.id);
            return (
              <Pressable
                key={t.id}
                testID={`ranking-tab-${t.id}`}
                onPress={() => setActive(t.id)}
                style={[styles.chip, isActive && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.chipText, isActive && { color: accent }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
          rows.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyTitle}>No rankings yet</Text></View>
          ) : rows.map((r) => {
            const isMe = r.user_id === user?.id;
            const accent = active === "uas" ? colors.brand : sportAccent(active);
            return (
              <Pressable
                key={r.user_id}
                testID={`ranking-row-${r.rank}`}
                onPress={() => router.push(`/athlete/${r.user_id}`)}
                style={[styles.row, isMe && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.rank, r.rank <= 3 && { color: accent }]}>{r.rank}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{r.display_name}{isMe ? " (You)" : ""}</Text>
                  <Text style={styles.rowMeta}>{r.city || "—"}{active === "uas" ? ` · ${r.sports_counted} sports` : (r.provisional ? " · Provisional" : "")}</Text>
                </View>
                <Text style={styles.rowValue}>
                  {active === "uas" ? r.uas : formatRating(r.rating, sportMeta?.decimals ?? 0)}
                </Text>
              </Pressable>
            );
          })
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  chipsRow: { marginTop: spacing.sm, height: 44 },
  chipsContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  rank: { width: 34, ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface, textAlign: "center" },
  rowName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  rowMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface },
});
