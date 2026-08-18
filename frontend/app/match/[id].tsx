import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

const EVENT_LABEL: Record<string, string> = {
  point: "POINT", let: "LET", stroke: "STROKE", no_let: "NO LET", undo: "UNDO",
  serve: "SERVE", fault: "FAULT",
};

export default function MatchDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.matchDetail(id as string)); } catch { setData(null); } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <SafeAreaView style={styles.root} edges={["top"]}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}><Pressable onPress={() => router.back()} testID="md-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.title}>MATCH</Text></View>
        <Text style={styles.hint}>Match not found.</Text>
      </SafeAreaView>
    );
  }

  const accent = sportAccent(data.sport_id);
  const my = data.my_rating || {};
  const when = (() => { try { return new Date(data.created_at).toLocaleString(); } catch { return data.created_at; } })();

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="match-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="md-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>{data.sport.name.toUpperCase()} MATCH</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* scoreboard */}
        <View style={styles.scoreCard}>
          {data.sides.map((s: any, idx: number) => (
            <View key={idx} style={styles.sideRow} testID={`md-side-${idx}`}>
              <Text style={[styles.sideName, s.won && { color: accent }]} numberOfLines={1}>
                {s.names.join(" / ") || "Athlete"}{s.won ? "  ★" : ""}
              </Text>
              <Text style={[styles.sideScore, s.won && { color: accent }]}>{data.side_wins ? data.side_wins[idx] : ""}</Text>
            </View>
          ))}
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBox}><Text style={styles.metaLabel}>TYPE</Text><Text style={styles.metaVal}>{data.competition ? data.competition.type.toUpperCase() : "ONE-OFF"}</Text></View>
          <View style={styles.metaBox}><Text style={styles.metaLabel}>SOURCE</Text><Text style={styles.metaVal}>{(data.source || "manual").toUpperCase()}</Text></View>
        </View>
        {data.competition && (
          <Pressable testID="md-comp-link" onPress={() => router.push(`/competition/${data.competition.id}`)} style={styles.compLink}>
            <Ionicons name="trophy-outline" size={16} color={accent} />
            <Text style={styles.compLinkText}>{data.competition.name}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}
        <Text style={styles.when}>{when}</Text>

        {/* game/set scores */}
        <Text style={styles.sectionTitle}>GAME SCORES</Text>
        <View style={styles.gamesWrap}>
          {(data.games || []).map((g: number[], i: number) => (
            <View key={i} style={styles.gameChip} testID={`md-game-${i}`}>
              <Text style={styles.gameLabel}>{data.sport_id === "tennis" || data.sport_id === "padel" ? "SET" : "G"}{i + 1}</Text>
              <Text style={styles.gameScore}>{g[0]}-{g[1]}</Text>
            </View>
          ))}
        </View>

        {/* rating change */}
        {my.before != null && (
          <>
            <Text style={styles.sectionTitle}>YOUR RATING</Text>
            <View style={styles.ratingCard}>
              <Text style={styles.ratingVal}>{my.before}</Text>
              <Ionicons name="arrow-forward" size={18} color={colors.onSurfaceTertiary} />
              <Text style={styles.ratingVal}>{my.after}</Text>
              <Text style={[styles.ratingDelta, { color: (my.delta ?? 0) >= 0 ? colors.success : colors.error }]}>{(my.delta ?? 0) >= 0 ? "+" : ""}{my.delta}</Text>
            </View>
          </>
        )}

        {/* live event history */}
        {data.events && data.events.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>LIVE EVENT HISTORY</Text>
            <View style={styles.eventsWrap}>
              {data.events.map((e: any, i: number) => (
                <View key={i} style={styles.eventRow} testID={`md-event-${i}`}>
                  <Text style={styles.eventSeq}>{e.seq ?? i + 1}</Text>
                  <Text style={styles.eventType}>{EVENT_LABEL[e.type] || String(e.type).toUpperCase()}</Text>
                  {e.side != null && <Text style={styles.eventSide}>Side {e.side + 1}</Text>}
                  {e.note ? <Text style={styles.eventNote}>{e.note}</Text> : null}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary, padding: spacing.md },
  scoreCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, padding: spacing.md, gap: spacing.sm },
  sideRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sideName: { ...font.textBold, fontSize: 16, color: colors.onSurface, flex: 1 },
  sideScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, marginLeft: spacing.md },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaBox: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  metaLabel: { ...font.textBold, letterSpacing: 2, fontSize: 9, color: colors.onSurfaceSecondary },
  metaVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface, marginTop: 2 },
  compLink: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compLinkText: { ...font.textBold, fontSize: 14, color: colors.onSurface, flex: 1 },
  when: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  sectionTitle: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  gamesWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gameChip: { alignItems: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, minWidth: 64 },
  gameLabel: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  gameScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  ratingCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  ratingVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface },
  ratingDelta: { ...font.textBold, fontSize: 16, marginLeft: "auto" },
  eventsWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  eventRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventSeq: { ...font.textBold, fontSize: 11, color: colors.onSurfaceTertiary, width: 28 },
  eventType: { ...font.textBold, fontSize: 12, color: colors.onSurface, width: 70 },
  eventSide: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  eventNote: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary, flex: 1 },
});
