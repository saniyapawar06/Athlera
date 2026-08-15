import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

export default function LiveSetupScreen() {
  const router = useRouter();
  const { sport_id, competition_id, fixture_id, opponent_id, opponent_name } = useLocalSearchParams<{ sport_id: string; competition_id?: string; fixture_id?: string; opponent_id?: string; opponent_name?: string }>();
  const accent = sportAccent(sport_id as string);
  const [rules, setRules] = useState<any>(null);
  const [mode, setMode] = useState<"oneoff" | "competition">(competition_id ? "competition" : "oneoff");
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponents, setOpponents] = useState<any[]>([]);
  const [opponent, setOpponent] = useState<any | null>(null);
  const [bestOf, setBestOf] = useState<number>(3);
  const [doubles, setDoubles] = useState(false);
  const [padelScoring, setPadelScoring] = useState<"advantage" | "golden_point" | "star_point">("advantage");
  const [firstServer, setFirstServer] = useState<number | null>(null);
  const [tossing, setTossing] = useState(false);
  const [comps, setComps] = useState<any[]>([]);
  const [comp, setComp] = useState<any | null>(null);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [fixture, setFixture] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const spin = useSharedValue(0);
  const coinStyle = useAnimatedStyle(() => ({ transform: [{ rotateY: `${spin.value}deg` }] }));

  useEffect(() => {
    (async () => {
      const cfg = await api.scoringConfig();
      const r = cfg.rules[sport_id as string];
      setRules(r);
      setBestOf(r.default_best_of);
    })();
  }, [sport_id]);

  // Pre-select opponent when arriving from the Score Match flow.
  useEffect(() => {
    if (opponent_id && opponent_name && !opponent) {
      setMode("oneoff");
      setOpponent({ user_id: opponent_id, display_name: decodeURIComponent(opponent_name as string), rating: "—" });
    }
  }, [opponent_id, opponent_name]);

  useEffect(() => {
    if (mode !== "oneoff") return;
    const t = setTimeout(async () => {
      try { const r = await api.opponents(sport_id as string, opponentQuery); setOpponents(r.opponents || []); } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [opponentQuery, mode, sport_id]);

  useEffect(() => {
    if (mode !== "competition") return;
    (async () => {
      const r = await api.compMine();
      setComps((r.competitions || []).filter((c: any) => c.sport_id === sport_id && c.fixtures_generated));
    })();
  }, [mode, sport_id]);

  const loadFixtures = async (c: any) => {
    setComp(c); setFixture(null);
    const d = await api.compDetail(c.id);
    // fixtures scheduled and involving me handled server-side membership; show scheduled ones
    setFixtures((d.fixtures || []).filter((f: any) => ["scheduled", "unscheduled"].includes(f.status)));
  };

  // Deep-link: score a specific fixture from the competition screen
  useEffect(() => {
    if (!competition_id || !fixture_id) return;
    (async () => {
      try {
        const d = await api.compDetail(competition_id as string);
        setMode("competition");
        setComp(d.competition);
        const fx = (d.fixtures || []).filter((f: any) => ["scheduled", "unscheduled"].includes(f.status));
        setFixtures(fx);
        const target = (d.fixtures || []).find((f: any) => f.id === fixture_id);
        if (target) setFixture(target);
      } catch { /* fall back to manual selection */ }
    })();
  }, [competition_id, fixture_id]);

  const doToss = async () => {
    setTossing(true);
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    spin.value = 0;
    spin.value = withRepeat(withTiming(360, { duration: 260, easing: Easing.linear }), -1, false);
    setTimeout(async () => {
      cancelAnimation(spin);
      spin.value = withTiming(0, { duration: 150 });
      const winner = Math.random() < 0.5 ? 0 : 1;
      setFirstServer(winner);
      setErr(null);
      setTossing(false);
      try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } catch {}
    }, 1400);
  };

  const start = async () => {
    setErr(null);
    if (mode === "oneoff" && !opponent) { setErr("Pick an opponent"); return; }
    if (mode === "competition" && !fixture) { setErr("Pick a fixture"); return; }
    if (firstServer == null) { setErr("Choose who serves first or skip the toss"); return; }
    setCreating(true);
    try {
      let payload: any = {
        sport_id, best_of: bestOf, doubles, golden_point: padelScoring !== "advantage",
        padel_scoring: padelScoring,
        first_server_side: firstServer,
      };
      if (mode === "oneoff") {
        payload.side1_user_ids = [opponent.user_id];
        payload.side1_label = opponent.display_name;
      } else {
        payload.side0_user_ids = fixture.sides[0].user_ids;
        payload.side1_user_ids = fixture.sides[1].user_ids;
        payload.competition_id = comp.id;
        payload.fixture_id = fixture.id;
      }
      const res = await api.liveCreate(payload);
      router.replace(`/live/${res.live_id}`);
    } catch (e: any) {
      setErr(e?.message || "Could not start match");
    } finally { setCreating(false); }
  };

  if (!rules) {
    return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="live-setup-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="setup-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>LIVE · {(sport_id as string).toUpperCase()}</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>MATCH TYPE</Text>
        <View style={styles.segment}>
          <Pressable testID="mode-oneoff" onPress={() => setMode("oneoff")} style={[styles.segBtn, mode === "oneoff" && { backgroundColor: colors.surfaceTertiary, borderColor: accent }]}>
            <Text style={[styles.segText, mode === "oneoff" && { color: colors.onSurface }]}>ONE-OFF MATCH</Text>
          </Pressable>
          <Pressable testID="mode-competition" onPress={() => setMode("competition")} style={[styles.segBtn, mode === "competition" && { backgroundColor: colors.surfaceTertiary, borderColor: accent }]}>
            <Text style={[styles.segText, mode === "competition" && { color: colors.onSurface }]}>COMPETITION</Text>
          </Pressable>
        </View>

        {mode === "oneoff" ? (
          <>
            <Text style={styles.sectionLabel}>OPPONENT</Text>
            {opponent ? (
              <Pressable testID="opponent-chosen" onPress={() => setOpponent(null)} style={[styles.chosen, { borderColor: accent }]}>
                <Text style={styles.chosenName}>{opponent.display_name}</Text>
                <Text style={styles.chosenMeta}>Rating {opponent.rating} · tap to change</Text>
              </Pressable>
            ) : (
              <>
                <TextInput testID="setup-opponent-search" value={opponentQuery} onChangeText={setOpponentQuery} placeholder="Search athletes…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                {opponents.slice(0, 6).map((o) => (
                  <Pressable key={o.user_id} testID={`setup-opp-${o.user_id}`} onPress={() => setOpponent(o)} style={styles.oppRow}>
                    <Text style={styles.oppName}>{o.display_name}</Text>
                    <Text style={styles.oppRating}>{o.rating}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>YOUR COMPETITIONS</Text>
            {comps.length === 0 ? <Text style={styles.hint}>No active competitions for this sport. Create one from the sport page.</Text> :
              comps.map((c) => (
                <Pressable key={c.id} testID={`setup-comp-${c.id}`} onPress={() => loadFixtures(c)} style={[styles.oppRow, comp?.id === c.id && { borderColor: accent }]}>
                  <Text style={styles.oppName}>{c.name}</Text>
                  <Text style={styles.oppRating}>{c.type}</Text>
                </Pressable>
              ))}
            {comp && (
              <>
                <Text style={styles.sectionLabel}>SCHEDULED FIXTURES</Text>
                {fixtures.length === 0 ? <Text style={styles.hint}>No fixtures ready to score.</Text> :
                  fixtures.map((f) => {
                    const nm = (uid: string) => ((comp?.members || []).find((m: any) => m.user_id === uid) || {}).display_name || "TBD";
                    const a = f.sides?.[0]?.user_ids?.[0] ? nm(f.sides[0].user_ids[0]) : "—";
                    const b = f.sides?.[1]?.user_ids?.[0] ? nm(f.sides[1].user_ids[0]) : "—";
                    return (
                      <Pressable key={f.id} testID={`setup-fixture-${f.id}`} onPress={() => setFixture(f)} style={[styles.oppRow, fixture?.id === f.id && { borderColor: accent }]}>
                        <Text style={styles.oppName}>{a} vs {b}</Text>
                        <Ionicons name={fixture?.id === f.id ? "radio-button-on" : "radio-button-off"} size={18} color={accent} />
                      </Pressable>
                    );
                  })}
              </>
            )}
          </>
        )}

        <Text style={styles.sectionLabel}>BEST OF</Text>
        <View style={styles.chipRow}>
          {rules.best_of_options.map((b: number) => (
            <Pressable key={b} testID={`bestof-${b}`} onPress={() => setBestOf(b)} style={[styles.chip, bestOf === b && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[styles.chipText, bestOf === b && { color: colors.onSurface }]}>BO{b}</Text>
            </Pressable>
          ))}
        </View>

        {rules.supports_doubles && (
          <Pressable testID="toggle-doubles" onPress={() => setDoubles(!doubles)} style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Doubles</Text>
            <View style={[styles.switch, doubles && { backgroundColor: accent }]}><View style={[styles.knob, doubles && { alignSelf: "flex-end" }]} /></View>
          </Pressable>
        )}
        {rules.golden_point_option && (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.sectionLabel}>PADEL POINT MODE</Text>
            <View style={styles.chipRow}>
              {(["advantage", "golden_point", "star_point"] as const).map((mode) => (
                <Pressable key={mode} testID={`padel-mode-${mode}`} onPress={() => setPadelScoring(mode)} style={[styles.chip, padelScoring === mode && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={[styles.chipText, padelScoring === mode && { color: colors.onSurface }]}>{mode === "golden_point" ? "GOLDEN" : mode === "star_point" ? "STAR" : "ADVANTAGE"}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>FIRST SERVER</Text>
        <View style={styles.segment}>
          {[0, 1].map((s) => {
            const label = s === 0 ? "You" : (mode === "oneoff" ? (opponent?.display_name || "Opponent") : "Opponent");
            return (
              <Pressable key={s} testID={`first-server-${s}`} onPress={() => { setFirstServer(s); setErr(null); }} style={[styles.segBtn, firstServer === s && { backgroundColor: colors.surfaceTertiary, borderColor: accent }]}>
                <Text style={[styles.segText, firstServer === s && { color: colors.onSurface }]} numberOfLines={1}>{label.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>

        {err && <Text style={styles.err} testID="setup-error">{err}</Text>}
      </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Pressable testID="start-live-btn" onPress={start} disabled={creating} style={[styles.startBtn, { backgroundColor: accent }, creating && { opacity: 0.6 }]}>
          {creating ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.startText}>START LIVE MATCH →</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, letterSpacing: 2 },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  sectionLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  segment: { flexDirection: "row", gap: spacing.sm },
  segBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  segText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  oppRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  oppName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  oppRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurfaceSecondary },
  chosen: { padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  chosenName: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  chosenMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  chipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: { height: 40, minWidth: 56, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 1, fontSize: 12, color: colors.onSurfaceSecondary },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  toggleLabel: { ...font.textMedium, fontSize: 14, color: colors.onSurface },
  switch: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary, padding: 3, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  tossBox: { alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  coin: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  coinText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30 },
  tossBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  tossBtnText: { ...font.textBold, letterSpacing: 2, fontSize: 12 },
  tossResult: { ...font.textMedium, fontSize: 13, color: colors.onSurface },
  skipBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  skipText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13, marginTop: spacing.sm },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  startBtn: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  startText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
