import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

const SPORTS = ["all", "squash", "padel", "tennis", "badminton", "pickleball"];
const RESULTS = ["all", "win", "loss"];
const SOURCES = ["all", "live", "manual"];

export default function MatchHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sport_id?: string }>();
  const [sport, setSport] = useState<string>((params.sport_id as string) || "all");
  const [result, setResult] = useState("all");
  const [source, setSource] = useState("all");
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string> = {};
      if (sport !== "all") p.sport_id = sport;
      if (result !== "all") p.result = result;
      if (source !== "all") p.source = source;
      const r = await api.matchHistory(p);
      setMatches(r.matches || []);
    } finally { setLoading(false); }
  }, [sport, result, source]);
  useEffect(() => { load(); }, [load]);

  const ChipRow = ({ items, value, onChange, tid }: any) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ height: 44 }}>
      {items.map((it: string) => (
        <Pressable key={it} testID={`${tid}-${it}`} onPress={() => onChange(it)} style={[styles.chip, value === it && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
          <Text style={[styles.chipText, value === it && { color: colors.onSurface }]}>{it.toUpperCase()}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="match-history-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="mh-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>MATCH HISTORY</Text>
      </View>
      <View style={styles.filters}>
        <ChipRow items={SPORTS} value={sport} onChange={setSport} tid="mh-sport" />
        <ChipRow items={RESULTS} value={result} onChange={setResult} tid="mh-result" />
        <ChipRow items={SOURCES} value={source} onChange={setSource} tid="mh-source" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
          matches.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>No matches for these filters</Text></View> :
          matches.map((m) => (
            <View key={m.id} style={styles.row} testID={`mh-row-${m.id}`}>
              <View style={[styles.wl, { backgroundColor: m.won ? colors.success : colors.error }]}><Text style={styles.wlText}>{m.won ? "W" : "L"}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.opp}>vs {m.opponent_name} · <Text style={{ color: sportAccent(m.sport_id) }}>{m.sport.name}</Text></Text>
                <Text style={styles.score}>{(m.games || []).map((g: number[]) => `${g[0]}-${g[1]}`).join("  ")}</Text>
                {(m.rating_before != null) && <Text style={styles.ratingLine}>{m.rating_before} → {m.rating_after}</Text>}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {m.rating_delta != null && <Text style={[styles.delta, { color: m.rating_delta >= 0 ? colors.success : colors.error }]}>{m.rating_delta >= 0 ? "+" : ""}{m.rating_delta}</Text>}
                <View style={styles.badges}>
                  <Text style={styles.src}>{(m.source || "manual").toUpperCase()}</Text>
                  {m.competition_id && <Text style={styles.comp}>COMP</Text>}
                </View>
              </View>
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 1 },
  filters: { paddingHorizontal: spacing.md, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  chipRow: { gap: spacing.sm, alignItems: "center", paddingRight: spacing.md },
  chip: { flexShrink: 0, height: 32, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  wl: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  wlText: { ...font.textBold, fontSize: 14, color: "#0B0D12" },
  opp: { ...font.textBold, fontSize: 13, color: colors.onSurface },
  score: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  ratingLine: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary },
  delta: { ...font.textBold, fontSize: 15 },
  badges: { flexDirection: "row", gap: 4, marginTop: 2 },
  src: { ...font.textBold, letterSpacing: 1, fontSize: 8, color: colors.onSurfaceTertiary },
  comp: { ...font.textBold, letterSpacing: 1, fontSize: 8, color: colors.brand },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
});
