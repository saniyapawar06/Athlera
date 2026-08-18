import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import PlayerMultiSelect, { SelectablePlayer } from "@/src/components/PlayerMultiSelect";
import DateTimeField from "@/src/components/DateTimeField";

const ALL_SPORTS = ["squash", "padel", "tennis", "badminton", "pickleball"];

type BuiltFixture = { a: string; b: string; at: Date | null };

export default function CompetitionCreateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sport_id: string; type: string }>();
  const [sid, setSid] = useState<string>((params.sport_id as string) || "squash");
  const accent = sportAccent(sid);
  const [name, setName] = useState("");
  const [type, setType] = useState<"league" | "knockout">(((params.type as string) === "knockout" ? "knockout" : "league"));
  const [players, setPlayers] = useState<SelectablePlayer[]>([]);
  const [fixtureMode, setFixtureMode] = useState<"automatic" | "manual">("automatic");
  const [mpo, setMpo] = useState(1);
  const [drawMode, setDrawMode] = useState<"rating" | "random" | "manual">("rating");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isKO = type === "knockout";
  const manualLeague = !isKO && fixtureMode === "manual";
  const isManual = manualLeague || (isKO && drawMode === "manual");

  // ---- Manual fixture / matchup builder ----
  const [built, setBuilt] = useState<BuiltFixture[]>([]);
  const [fbA, setFbA] = useState<string | null>(null);
  const [fbB, setFbB] = useState<string | null>(null);
  const [fbAt, setFbAt] = useState<Date | null>(null);

  const nameOf = (id: string) => players.find((p) => p.user_id === id)?.display_name || "Player";

  // Keep the builder consistent with the selected player list.
  useEffect(() => {
    const ids = new Set(players.map((p) => p.user_id));
    setBuilt((prev) => prev.filter((f) => ids.has(f.a) && ids.has(f.b)));
    setFbA((cur) => (cur && ids.has(cur) ? cur : null));
    setFbB((cur) => (cur && ids.has(cur) ? cur : null));
  }, [players]);

  const usedIds = new Set(built.flatMap((f) => [f.a, f.b]));
  // For knockout each player appears in exactly one first-round matchup.
  const availableFor = (slot: "a" | "b") =>
    players.filter((p) => {
      if (isKO && usedIds.has(p.user_id)) return false;
      if (slot === "a" && p.user_id === fbB) return false;
      if (slot === "b" && p.user_id === fbA) return false;
      return true;
    });

  const addBuilt = () => {
    setErr(null);
    if (!fbA || !fbB) { setErr("Pick both players"); return; }
    if (fbA === fbB) { setErr("Pick two different players"); return; }
    setBuilt((prev) => [...prev, { a: fbA, b: fbB, at: fbAt }]);
    setFbA(null); setFbB(null); setFbAt(null);
  };
  const removeBuilt = (idx: number) => setBuilt((prev) => prev.filter((_, i) => i !== idx));

  const create = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Give your competition a name"); return; }
    if (players.length < 2) { setErr("Add at least 2 players"); return; }
    if (isManual && built.length < 1) { setErr(isKO ? "Add at least one first-round matchup" : "Add at least one fixture"); return; }
    setBusy(true);
    try {
      const manual_pairs = isManual ? built.map((f) => [f.a, f.b]) : [];
      const manual_schedule = isManual ? built.map((f) => (f.at ? f.at.toISOString() : null)) : [];
      const res = await api.compCreate({
        name: name.trim(), sport_id: sid, type, visibility: "private",
        matches_per_opponent: mpo,
        fixture_mode: isKO ? "automatic" : fixtureMode,
        draw_mode: isKO ? drawMode : "rating",
        manual_pairs, manual_schedule,
        max_participants: Math.max(16, players.length + 1),
      });
      const cid = res.competition.id;
      // add selected players
      for (const p of players) {
        try { await api.compAddMember(cid, p.user_id); } catch { /* skip dupes */ }
      }
      // build fixtures now (automatic round-robin / seeded draw, or the manual pairings)
      try { await api.compGenerate(cid); } catch { /* organiser can retry from detail */ }
      router.replace(`/competition/${cid}`);
    } catch (e: any) { setErr(e?.message || "Could not create"); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="competition-create-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="cc-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>NEW {isKO ? "KNOCKOUT" : "LEAGUE"}</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.privateBadge}>
            <Ionicons name="lock-closed" size={13} color={colors.onSurfaceSecondary} />
            <Text style={styles.privateText}>PRIVATE · SOCIAL COMPETITION — invite-only, no fees</Text>
          </View>

          <Text style={styles.label}>SPORT</Text>
          <View style={styles.row}>
            {ALL_SPORTS.map((s) => (
              <Pressable key={s} testID={`cc-sport-${s}`} onPress={() => setSid(s)} style={[styles.pill, sid === s && { borderColor: sportAccent(s), backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.pillText, sid === s && { color: sportAccent(s) }]}>{s.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Field label="COMPETITION NAME">
            <TextInput testID="cc-name" value={name} onChangeText={setName} placeholder={isKO ? "e.g. Club Knockout Cup" : "e.g. Winter League"} placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          </Field>

          <Text style={styles.label}>FORMAT</Text>
          <View style={styles.row}>
            {(["league", "knockout"] as const).map((t) => (
              <Pressable key={t} testID={`cc-type-${t}`} onPress={() => setType(t)} style={[styles.pill, type === t && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.pillText, type === t && { color: colors.onSurface }]}>{t.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>PLAYERS · {players.length} SELECTED</Text>
          <PlayerMultiSelect sportId={sid} accent={accent} selected={players} onChange={setPlayers} />

          {!isKO && (
            <>
              <Text style={styles.label}>FIXTURES</Text>
              <View style={styles.row}>
                {(["automatic", "manual"] as const).map((m) => (
                  <Pressable key={m} testID={`cc-fixmode-${m}`} onPress={() => setFixtureMode(m)} style={[styles.pill, fixtureMode === m && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.pillText, fixtureMode === m && { color: colors.onSurface }]}>{m === "automatic" ? "AUTO (ROUND-ROBIN)" : "MANUAL"}</Text>
                  </Pressable>
                ))}
              </View>
              {fixtureMode === "automatic" && (
                <>
                  <Text style={styles.label}>MATCHES PER OPPONENT</Text>
                  <View style={styles.row}>{[1, 2, 3].map((n) => (
                    <Pressable key={n} testID={`cc-mpo-${n}`} onPress={() => setMpo(n)} style={[styles.pill, mpo === n && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                      <Text style={[styles.pillText, mpo === n && { color: colors.onSurface }]}>{n}x</Text>
                    </Pressable>
                  ))}</View>
                </>
              )}
            </>
          )}

          {isKO && (
            <>
              <Text style={styles.label}>DRAW</Text>
              <View style={styles.row}>
                {([["rating", "BY RATING/SEED"], ["random", "RANDOM DRAW"], ["manual", "MANUAL DRAW"]] as const).map(([m, lbl]) => (
                  <Pressable key={m} testID={`cc-draw-${m}`} onPress={() => setDrawMode(m)} style={[styles.pill, drawMode === m && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.pillText, drawMode === m && { color: colors.onSurface }]}>{lbl}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* Manual Add Fixture / Add Matchup builder (leagues & knockouts share the same flow) */}
          {isManual && (
            <View style={{ gap: spacing.sm }} testID="manual-builder">
              <Text style={styles.label}>{isKO ? "FIRST-ROUND MATCHUPS" : "FIXTURES"} · {built.length} ADDED</Text>
              {players.length < 2 && <Text style={styles.hint}>Select players above first.</Text>}

              {built.map((f, idx) => (
                <View key={idx} style={styles.builtRow} testID={`mb-fixture-${idx}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.builtText} numberOfLines={1}>{idx + 1}. {nameOf(f.a)}  vs  {nameOf(f.b)}</Text>
                    <Text style={styles.builtWhen}>{f.at ? fmtWhen(f.at) : "UNSCHEDULED"}</Text>
                  </View>
                  <Pressable testID={`mb-remove-${idx}`} onPress={() => removeBuilt(idx)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </View>
              ))}

              {players.length >= 2 && (!isKO || availableFor("a").length + (fbA ? 1 : 0) > 0) && (
                <View style={styles.composer}>
                  <Text style={styles.miniLabel}>PLAYER 1</Text>
                  <View style={styles.chipRow}>
                    {availableFor("a").map((p) => (
                      <Pressable key={p.user_id} testID={`mb-a-${p.user_id}`} onPress={() => setFbA(p.user_id)} style={[styles.chip, fbA === p.user_id && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                        <Text style={[styles.chipText, fbA === p.user_id && { color: colors.onSurface }]}>{p.display_name}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.miniLabel}>PLAYER 2</Text>
                  <View style={styles.chipRow}>
                    {availableFor("b").map((p) => (
                      <Pressable key={p.user_id} testID={`mb-b-${p.user_id}`} onPress={() => setFbB(p.user_id)} style={[styles.chip, fbB === p.user_id && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                        <Text style={[styles.chipText, fbB === p.user_id && { color: colors.onSurface }]}>{p.display_name}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.miniLabel}>DATE & TIME (OPTIONAL)</Text>
                  <DateTimeField value={fbAt} onChange={setFbAt} accent={accent} testIDPrefix="mb-dt" />

                  <Pressable testID="mb-add" onPress={addBuilt} style={[styles.addBtn, { borderColor: accent }]}>
                    <Ionicons name="add" size={18} color={accent} />
                    <Text style={[styles.addBtnText, { color: accent }]}>{isKO ? "ADD MATCHUP" : "ADD FIXTURE"}</Text>
                  </Pressable>
                </View>
              )}
              {isKO && <Text style={styles.hint}>Any player left unpaired gets a bye automatically.</Text>}
            </View>
          )}

          {err && <Text style={styles.err} testID="cc-error">{err}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Pressable testID="cc-submit" onPress={create} disabled={busy} style={[styles.cta, { backgroundColor: accent }, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>CREATE →</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text>{children}</View>;
}

function fmtWhen(d: Date) {
  try {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return "SCHEDULED"; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  privateBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  privateText: { ...font.textBold, letterSpacing: 0.5, fontSize: 10, color: colors.onSurfaceSecondary, flexShrink: 1 },
  label: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  miniLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pill: { minHeight: 40, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  pillText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  hint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13 },
  builtRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  builtText: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  builtWhen: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 2 },
  composer: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipText: { ...font.textBold, fontSize: 12, color: colors.onSurfaceSecondary },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, borderWidth: 1, borderRadius: radius.md, borderStyle: "dashed", backgroundColor: colors.surface, marginTop: 4 },
  addBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 12 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 1.5, fontSize: 13, color: "#0B0D12" },
});
