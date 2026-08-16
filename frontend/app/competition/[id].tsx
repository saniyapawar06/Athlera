import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { Confetti } from "@/src/components/ResultOverlay";

type Tab = "fixtures" | "standings" | "players";

export default function CompetitionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("fixtures");
  const [busy, setBusy] = useState(false);
  const [scoringFixture, setScoringFixture] = useState<any | null>(null);
  const [g, setG] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.compDetail(cid)); } finally { setLoading(false); }
  }, [cid]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) {
    return <SafeAreaView style={styles.root} edges={["top"]}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }
  const c = data.competition;
  const accent = sportAccent(c.sport_id);
  const isKO = c.type === "knockout";
  const champion = c.status === "complete" && c.champion_ids;

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); } catch (e: any) { setErr(e?.message || "Action failed"); } finally { setBusy(false); }
  };

  const submitFixture = async () => {
    const games = g.filter((x) => x.a !== "" && x.b !== "").map((x) => [Number(x.a), Number(x.b)]);
    if (!games.length) { setErr("Enter a score"); return; }
    setBusy(true); setErr(null);
    try {
      await api.fixtureManualResult(scoringFixture.id, games);
      setScoringFixture(null); setG([{ a: "", b: "" }]);
      await load();
    } catch (e: any) { setErr(e?.message || "Invalid score"); } finally { setBusy(false); }
  };

  const rounds = Array.from(new Set(data.fixtures.map((f: any) => f.round))).sort((a: any, b: any) => a - b);

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="competition-detail-screen">
      {champion && <Confetti />}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="cd-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: accent }]} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.sub}>{c.type.toUpperCase()} · {c.city || "—"} · {c.member_count} players · {c.status.replace(/_/g, " ")}</Text>
        </View>
      </View>

      {champion && (
        <View style={[styles.champBanner, { borderColor: accent }]} testID="champion-banner">
          <Ionicons name="trophy" size={22} color={accent} />
          <Text style={styles.champText}>CHAMPION: {(c.members.find((m: any) => c.champion_ids.includes(m.user_id)) || {}).display_name || "TBD"}</Text>
        </View>
      )}

      {/* organiser controls */}
      {c.is_organiser && (
        <View style={styles.orgBar}>
          <Text style={styles.orgLabel}>ORGANISER</Text>
          {!c.fixtures_generated ? (
            <Pressable testID="generate-fixtures-btn" onPress={() => act(() => api.compGenerate(cid))} disabled={busy} style={[styles.orgBtn, { backgroundColor: accent }]}>
              <Text style={styles.orgBtnText}>{busy ? "…" : "GENERATE FIXTURES"}</Text>
            </Pressable>
          ) : (
            <Text style={styles.orgHint}>Fixtures generated · score them below</Text>
          )}
        </View>
      )}

      {/* register / withdraw */}
      {!c.is_organiser && (
        <View style={styles.orgBar}>
          {c.is_member ? (
            <Pressable testID="withdraw-btn" onPress={() => act(() => api.compWithdraw(cid))} disabled={busy} style={[styles.orgBtn, { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border }]}>
              <Text style={[styles.orgBtnText, { color: colors.onSurface }]}>WITHDRAW</Text>
            </Pressable>
          ) : (
            <Pressable testID="register-btn" onPress={() => act(() => api.compRegister(cid))} disabled={busy} style={[styles.orgBtn, { backgroundColor: accent }]}>
              <Text style={styles.orgBtnText}>{busy ? "…" : "REGISTER"}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.tabs}>
        {((isKO ? ["fixtures", "players"] : ["fixtures", "standings", "players"]) as Tab[]).map((t) => (
          <Pressable key={t} testID={`cd-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: accent }]}>
            <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]}>{t === "fixtures" ? (isKO ? "BRACKET" : "FIXTURES") : t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {err && <Text style={styles.err} testID="cd-error">{err}</Text>}
        {tab === "fixtures" && (
          data.fixtures.length === 0 ? <Text style={styles.hint}>No fixtures yet.{c.is_organiser ? " Generate them above." : ""}</Text> :
          rounds.map((r: any) => (
            <View key={r} style={{ gap: spacing.sm }}>
              <Text style={styles.roundLabel}>{isKO ? `ROUND ${r}` : "FIXTURES"}</Text>
              {data.fixtures.filter((f: any) => f.round === r).map((f: any) => {
                const n0 = f.sides[0].user_ids.length ? memberName(c, f.sides[0].user_ids[0]) : "—";
                const n1 = f.sides[1].user_ids.length ? memberName(c, f.sides[1].user_ids[0]) : "—";
                const done = f.status === "complete";
                const bye = f.status === "bye";
                return (
                  <View key={f.id} style={styles.fixture} testID={`fixture-${f.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.fName, done && f.winner_side === 0 && { color: accent }]}>{n0}</Text>
                      <Text style={[styles.fName, done && f.winner_side === 1 && { color: accent }]}>{n1}</Text>
                    </View>
                    {done ? <Text style={styles.fScore}>{(f.score || []).join("-")}</Text> :
                      bye ? <Text style={styles.fBye}>BYE</Text> :
                      c.is_organiser ? (
                        <View style={{ gap: 4 }}>
                          <Pressable testID={`score-live-${f.id}`} onPress={() => router.push(`/live/setup?sport_id=${c.sport_id}`)} style={styles.fLive}><Text style={styles.fLiveText}>LIVE</Text></Pressable>
                          <Pressable testID={`score-manual-${f.id}`} onPress={() => { setScoringFixture(f); setG([{ a: "", b: "" }]); }} style={styles.fManual}><Text style={styles.fManualText}>ENTER</Text></Pressable>
                        </View>
                      ) : <Text style={styles.fSched}>SCHEDULED</Text>}
                  </View>
                );
              })}
            </View>
          ))
        )}

        {tab === "standings" && (
          data.standings.length === 0 ? <Text style={styles.hint}>No results yet.</Text> :
          <View style={{ gap: 6 }}>
            <View style={styles.stHeadRow}><Text style={[styles.stHead, { width: 28 }]}>#</Text><Text style={[styles.stHead, { flex: 1 }]}>PLAYER</Text><Text style={styles.stHead}>P</Text><Text style={styles.stHead}>W</Text><Text style={styles.stHead}>PTS</Text></View>
            {data.standings.map((s: any) => (
              <View key={s.user_id} style={styles.stRow} testID={`standings-${s.position}`}>
                <Text style={[styles.stCell, { width: 28, color: accent }]}>{s.position}</Text>
                <Text style={[styles.stCell, { flex: 1, textAlign: "left" }]} numberOfLines={1}>{s.display_name}</Text>
                <Text style={styles.stCell}>{s.played}</Text><Text style={styles.stCell}>{s.wins}</Text>
                <Text style={[styles.stCell, styles.stPts]}>{s.points}</Text>
              </View>
            ))}
          </View>
        )}

        {tab === "players" && (
          <View style={{ gap: spacing.sm }}>
            {c.members.map((m: any) => (
              <Pressable key={m.user_id} testID={`player-${m.user_id}`} onPress={() => router.push(`/athlete/${m.user_id}`)} style={styles.playerRow}>
                <Text style={styles.playerName}>{m.display_name}</Text>
                <Text style={styles.playerRole}>{m.role.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* manual score sheet */}
      {scoringFixture && (
        <View style={styles.sheet} testID="manual-score-sheet">
          <Text style={styles.sheetTitle}>ENTER RESULT</Text>
          <Text style={styles.sheetSub}>{memberName(c, scoringFixture.sides[0].user_ids[0])} vs {memberName(c, scoringFixture.sides[1].user_ids[0])}</Text>
          {g.map((row, i) => (
            <View key={i} style={styles.gRow}>
              <TextInput testID={`mg-a-${i}`} value={row.a} onChangeText={(v) => setG((p) => p.map((x, idx) => idx === i ? { ...x, a: v.replace(/[^0-9]/g, "") } : x))} placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" style={styles.gInput} maxLength={2} />
              <Text style={styles.gDash}>—</Text>
              <TextInput testID={`mg-b-${i}`} value={row.b} onChangeText={(v) => setG((p) => p.map((x, idx) => idx === i ? { ...x, b: v.replace(/[^0-9]/g, "") } : x))} placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" style={styles.gInput} maxLength={2} />
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="mg-add" onPress={() => setG((p) => [...p, { a: "", b: "" }])} style={styles.ghost}><Text style={styles.ghostText}>+ GAME</Text></Pressable>
            <Pressable testID="mg-cancel" onPress={() => setScoringFixture(null)} style={styles.ghost}><Text style={styles.ghostText}>CANCEL</Text></Pressable>
          </View>
          <Pressable testID="mg-submit" onPress={submitFixture} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}>
            <Text style={styles.ctaText}>SAVE RESULT</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function memberName(c: any, uid: string) {
  const m = (c.members || []).find((x: any) => x.user_id === uid);
  return m ? m.display_name : "Athlete";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, letterSpacing: 1 },
  sub: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary },
  champBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  champText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface, letterSpacing: 1 },
  orgBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  orgLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  orgBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  orgBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 12, color: "#0B0D12" },
  orgHint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  tabs: { flexDirection: "row", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceTertiary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13 },
  roundLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  fixture: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  fName: { ...font.textBold, fontSize: 14, color: colors.onSurface, marginVertical: 1 },
  fScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  fBye: { ...font.textBold, fontSize: 11, color: colors.onSurfaceTertiary, letterSpacing: 1 },
  fSched: { ...font.textBold, fontSize: 10, color: colors.onSurfaceTertiary, letterSpacing: 1 },
  fLive: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  fLiveText: { ...font.textBold, fontSize: 10, color: colors.brand, letterSpacing: 1 },
  fManual: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  fManualText: { ...font.textBold, fontSize: 10, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  stHeadRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  stHead: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary, width: 36, textAlign: "center" },
  stRow: { flexDirection: "row", alignItems: "center", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  stCell: { ...font.textMedium, fontSize: 13, color: colors.onSurface, width: 36, textAlign: "center" },
  stPts: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 18 },
  playerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  playerName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  playerRole: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  sheetSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  gRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  gInput: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, textAlign: "center", paddingVertical: spacing.sm, borderRadius: radius.md, ...font.display, fontFamily: "BarlowCondensed", fontSize: 24 },
  gDash: { ...font.textBold, color: colors.onSurfaceTertiary },
  ghost: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  ghostText: { ...font.textBold, fontSize: 11, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
