import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent, timeAgo } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

export default function MatchDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [m, setM] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.matchDetail(id as string);
      setM(d.match);
      setShared(d.match.already_shared);
    } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const share = async () => {
    if (!m) return;
    setBusy(true);
    try { await api.feedShareMatch(m.id, undefined); setShared(true); }
    catch { /* noop */ } finally { setBusy(false); }
  };

  if (loading || !m) {
    return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  const accent = sportAccent(m.sport_id);
  const catLabel = m.category === "knockout" ? "KNOCKOUT" : m.category === "league" ? "LEAGUE" : "ONE-OFF";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="match-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="match-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>{m.sport_name?.toUpperCase()}</Text>
        <View style={[styles.catBadge, { borderColor: accent }]}><Text style={[styles.catText, { color: accent }]}>{catLabel}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {m.competition ? (
          <Pressable testID="match-comp-link" onPress={() => router.push(`/competition/${m.competition.id}`)} style={styles.compRow}>
            <Ionicons name="trophy-outline" size={16} color={accent} />
            <Text style={styles.compName}>{m.competition.name}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        ) : null}

        <View style={styles.scoreCard}>
          <View style={styles.playerCol}>
            {m.participants.map((p: any) => {
              const won = p.user_id === m.winner_user_id;
              return (
                <Pressable key={p.user_id} testID={`match-player-${p.user_id}`} onPress={() => router.push(`/athlete/${p.user_id}`)} style={styles.playerRow}>
                  {won && <Ionicons name="checkmark-circle" size={16} color={colors.success} />}
                  <Text style={[styles.playerName, won && { color: colors.onSurface }]} numberOfLines={1}>{p.display_name}{p.user_id === user?.id ? " (You)" : ""}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.gamesCol}>
            {(m.games || []).map((g: number[], i: number) => (
              <View key={i} style={styles.gameCol}>
                <Text style={[styles.gameNum, g[0] > g[1] && styles.gameWin]}>{g[0]}</Text>
                <Text style={[styles.gameNum, g[1] > g[0] && styles.gameWin]}>{g[1]}</Text>
              </View>
            ))}
          </View>
        </View>

        {m.preview?.tag ? (
          <View style={[styles.tag, { borderColor: accent }]}><Text style={[styles.tagText, { color: accent }]}>{m.preview.tag}</Text></View>
        ) : null}

        {m.rating_changes ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RATING MOVEMENT</Text>
            {m.participants.map((p: any) => {
              const rc = m.rating_changes[p.user_id];
              if (!rc) return null;
              const up = (rc.delta ?? 0) >= 0;
              return (
                <View key={p.user_id} style={styles.rcRow} testID={`rc-${p.user_id}`}>
                  <Text style={styles.rcName}>{p.display_name}</Text>
                  <Text style={styles.rcVals}>{rc.before} → {rc.after}</Text>
                  <Text style={[styles.rcDelta, { color: up ? colors.success : colors.error }]}>{up ? "+" : ""}{rc.delta}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.time}>{m.status === "verified" ? "Verified" : m.status} · {timeAgo(m.created_at)}</Text>
        {m.note ? <Text style={styles.note}>“{m.note}”</Text> : null}

        <Pressable testID="match-share-btn" onPress={share} disabled={shared || busy} style={[styles.shareBtn, shared && { opacity: 0.5 }]}>
          <Ionicons name={shared ? "checkmark" : "share-social-outline"} size={18} color={colors.onBrand} />
          <Text style={styles.shareText}>{shared ? "SHARED TO FEED" : "SHARE TO FEED"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, letterSpacing: 2, flex: 1 },
  catBadge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  catText: { ...font.textBold, fontSize: 9, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  compRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compName: { ...font.textBold, fontSize: 14, color: colors.onSurface, flex: 1 },
  scoreCard: { flexDirection: "row", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  playerCol: { flex: 1, justifyContent: "space-around", gap: spacing.md },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  playerName: { ...font.textMedium, fontSize: 15, color: colors.onSurfaceSecondary, flexShrink: 1 },
  gamesCol: { flexDirection: "row", gap: spacing.md },
  gameCol: { justifyContent: "space-around", alignItems: "center", gap: spacing.md },
  gameNum: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurfaceTertiary },
  gameWin: { color: colors.onSurface },
  tag: { alignSelf: "flex-start", borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  tagText: { ...font.textBold, fontSize: 11, letterSpacing: 1 },
  section: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  sectionLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  rcRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rcName: { ...font.textMedium, fontSize: 14, color: colors.onSurface, flex: 1 },
  rcVals: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, marginRight: spacing.md },
  rcDelta: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20 },
  time: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  note: { ...font.text, fontSize: 14, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  shareBtn: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.md, marginTop: spacing.sm },
  shareText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
});
