import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating, SPORT_ICONS } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

type Phase = "sport" | "opponent" | "method" | "score" | "review";

export default function ScoreTab() {
  const { user } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("sport");
  const [allSports, setAllSports] = useState<any[]>([]);
  const [myRatings, setMyRatings] = useState<Record<string, any>>({});
  const [sportId, setSportId] = useState<string | null>(null);
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponents, setOpponents] = useState<any[]>([]);
  const [opponent, setOpponent] = useState<any | null>(null);
  const [matchType, setMatchType] = useState<"oneoff" | "competition">("oneoff");
  const [myComps, setMyComps] = useState<any[]>([]);
  const [games, setGames] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<any | null>(null);
  const [shared, setShared] = useState(false);

  const sportMeta = useMemo(() => allSports.find((s) => s.id === sportId), [allSports, sportId]);

  const loadBase = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.sports(), api.dashboard()]);
      setAllSports(s.sports || []);
      const map: Record<string, any> = {};
      (d.cards || []).forEach((c: any) => { map[c.sport_id] = c; });
      setMyRatings(map);
    } catch { /* noop */ }
    try {
      const c = await api.compMine();
      setMyComps((c.competitions || []).filter((x: any) => x.fixtures_generated));
    } catch { /* noop */ }
  }, []);

  useFocusEffect(useCallback(() => { loadBase(); }, [loadBase]));

  useEffect(() => {
    if (!sportId || phase !== "opponent") { return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.opponents(sportId, opponentQuery);
        setOpponents(r.opponents || []);
      } catch { /* noop */ }
    }, 200);
    return () => clearTimeout(t);
  }, [sportId, opponentQuery, phase]);

  const reset = () => {
    setPhase("sport"); setSportId(null); setOpponent(null); setOpponentQuery("");
    setGames([{ a: "", b: "" }]); setPreview(null); setSubmitted(null); setErr(null); setShared(false);
    setMatchType("oneoff");
  };

  const goLive = () => {
    if (!opponent) return;
    router.push(`/live/setup?sport_id=${sportId}&opponent_id=${opponent.user_id}&opponent_name=${encodeURIComponent(opponent.display_name)}`);
  };

  const runPreview = async () => {
    setErr(null); setBusy(true);
    try {
      const parsedGames = games.filter((g) => g.a !== "" && g.b !== "").map((g) => [Number(g.a), Number(g.b)]);
      if (parsedGames.length === 0) { setErr("Enter at least one game"); return; }
      const p = await api.matchPreview({ sport_id: sportId!, opponent_user_id: opponent.user_id, games: parsedGames });
      setPreview(p);
      setPhase("review");
    } catch (e: any) { setErr(e?.message || "Preview failed"); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const parsedGames = games.filter((g) => g.a !== "" && g.b !== "").map((g) => [Number(g.a), Number(g.b)]);
      const res = await api.matchSubmit({ sport_id: sportId!, opponent_user_id: opponent.user_id, games: parsedGames });
      setSubmitted(res.match);
    } catch (e: any) { setErr(e?.message || "Submit failed"); }
    finally { setBusy(false); }
  };

  const shareToFeed = async () => {
    if (!submitted) return;
    setBusy(true);
    try { await api.feedShareMatch(submitted.id, undefined); setShared(true); }
    catch { /* noop */ } finally { setBusy(false); }
  };

  const isSetSport = sportMeta?.id === "tennis" || sportMeta?.id === "padel";
  const accent = sportId ? sportAccent(sportId) : colors.brand;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="score-screen">
      <View style={styles.header}>
        <Text style={styles.title}>SCORE MATCH</Text>
        <Text style={styles.subtitle}>Pick a sport, an opponent, then go live or enter a final score</Text>
      </View>

      {/* Progress dots */}
      {!submitted && (
        <View style={styles.stepper}>
          {(["sport", "opponent", "method"] as Phase[]).map((p, i) => {
            const order = ["sport", "opponent", "method", "score", "review"];
            const active = order.indexOf(phase) >= order.indexOf(p);
            return (
              <React.Fragment key={p}>
                <View style={[styles.step, active && { borderColor: accent, backgroundColor: accent }]}>
                  <Text style={[styles.stepText, active && { color: "#0B0D12" }]}>{i + 1}</Text>
                </View>
                {i < 2 && <View style={[styles.stepLine, active && { backgroundColor: accent }]} />}
              </React.Fragment>
            );
          })}
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {submitted ? (
            <Animated.View entering={FadeIn.duration(400)} style={styles.successCard} testID="match-submitted">
              <Ionicons name="checkmark-circle" size={54} color={colors.success} />
              <Text style={styles.successTitle}>MATCH RECORDED</Text>
              <Text style={styles.successSub}>
                {submitted.status === "verified" ? "Verified — ratings updated." : "Pending opponent confirmation."}
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                <Pressable onPress={() => router.push(`/match/${submitted.id}`)} style={[styles.secondaryBtn]} testID="view-match-btn">
                  <Text style={styles.secondaryBtnText}>VIEW MATCH</Text>
                </Pressable>
                <Pressable onPress={shareToFeed} disabled={shared || busy} style={[styles.secondaryBtn, { borderColor: colors.brand }, shared && { opacity: 0.5 }]} testID="share-feed-btn">
                  <Ionicons name={shared ? "checkmark" : "share-social-outline"} size={15} color={colors.brand} />
                  <Text style={[styles.secondaryBtnText, { color: colors.brand }]}>{shared ? "SHARED" : "SHARE TO FEED"}</Text>
                </Pressable>
              </View>
              <Pressable onPress={reset} style={styles.primaryBtn} testID="new-match-btn">
                <Text style={styles.primaryBtnText}>NEW MATCH</Text>
              </Pressable>
            </Animated.View>
          ) : phase === "sport" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>1 · Which sport?</Text>
              <Text style={styles.hint}>All ATHLERA sports are available. New sports start at a provisional rating.</Text>
              {allSports.map((s) => {
                const mine = myRatings[s.id];
                return (
                  <Pressable
                    key={s.id}
                    testID={`pick-sport-${s.id}`}
                    onPress={() => { setSportId(s.id); setPhase("opponent"); }}
                    style={({ pressed }) => [styles.rowBtn, { borderLeftColor: s.accent }, pressed && { opacity: 0.85 }]}
                  >
                    <View style={[styles.sportIcon, { backgroundColor: s.accent + "22" }]}>
                      <Ionicons name={(SPORT_ICONS[s.id] as any) || "ellipse-outline"} size={20} color={s.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: s.accent }]}>{s.name.toUpperCase()}</Text>
                      <Text style={styles.rowSub}>
                        {mine ? `Your rating ${formatRating(mine.rating, mine.decimals)}${mine.provisional ? " · Provisional" : ` · Rank #${mine.rank}`}` : "New sport · Provisional rating"}
                      </Text>
                    </View>
                    {!mine && <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>}
                    <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                  </Pressable>
                );
              })}
            </View>
          ) : phase === "opponent" ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("sport")} testID="back-to-sport"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>2 · Opponent</Text>
              </View>
              <TextInput
                testID="opponent-search"
                placeholder="Search athletes…"
                placeholderTextColor={colors.onSurfaceTertiary}
                value={opponentQuery}
                onChangeText={setOpponentQuery}
                style={styles.input}
              />
              {opponents.map((o) => (
                <Pressable
                  key={o.user_id}
                  testID={`pick-opponent-${o.user_id}`}
                  onPress={() => { setOpponent(o); setPhase("method"); }}
                  style={({ pressed }) => [styles.rowBtn, pressed && { opacity: 0.85 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{o.display_name}</Text>
                    <Text style={styles.rowSub}>{o.city || "—"} · Rating {o.rating}{o.provisional ? " (P)" : ""}{!o.plays_sport ? " · new to sport" : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
              {opponents.length === 0 && <Text style={styles.hint}>No athletes match — try a different name.</Text>}
            </View>
          ) : phase === "method" ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("opponent")} testID="back-to-opponent"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>3 · How to score</Text>
              </View>
              <View style={styles.oppCard} testID="method-summary">
                <View style={[styles.sportIcon, { backgroundColor: accent + "22" }]}>
                  <Ionicons name={(SPORT_ICONS[sportId!] as any) || "ellipse-outline"} size={20} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppLabel}>YOU vs {opponent?.display_name?.toUpperCase()}</Text>
                  <Text style={styles.oppMeta}>{sportMeta?.name}</Text>
                </View>
              </View>

              <View style={styles.matchTypeRow}>
                {(["oneoff", "competition"] as const).map((t) => (
                  <Pressable key={t} testID={`match-type-${t}`} onPress={() => setMatchType(t)} style={[styles.mtBtn, matchType === t && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.mtText, matchType === t && styles.mtTextActive]}>{t === "oneoff" ? "ONE-OFF" : "COMPETITION"}</Text>
                  </Pressable>
                ))}
              </View>

              {matchType === "oneoff" ? (
                <View style={{ gap: spacing.sm }}>
                  <Pressable testID="method-live" onPress={goLive} style={({ pressed }) => [styles.methodCard, { borderColor: accent }, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="radio" size={26} color={accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.methodTitle}>LIVE SCORE</Text>
                      <Text style={styles.methodSub}>Point-by-point scoreboard, ratings on finish</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                  </Pressable>
                  <Pressable testID="method-final" onPress={() => { setPhase("score"); setErr(null); }} style={({ pressed }) => [styles.methodCard, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="create-outline" size={26} color={colors.onSurface} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.methodTitle}>ENTER FINAL SCORE</Text>
                      <Text style={styles.methodSub}>Already played? Type the result & preview rating</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  <Text style={styles.hint}>Open a competition to live-score or enter results for its fixtures.</Text>
                  {myComps.filter((c) => c.sport_id === sportId).length === 0 ? (
                    <Text style={styles.hint}>No competitions with fixtures for this sport yet. Create one from the Compete tab.</Text>
                  ) : myComps.filter((c) => c.sport_id === sportId).map((c) => (
                    <Pressable key={c.id} testID={`comp-result-${c.id}`} onPress={() => router.push(`/competition/${c.id}`)} style={({ pressed }) => [styles.rowBtn, { borderLeftColor: sportAccent(c.sport_id) }, pressed && { opacity: 0.85 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowTitle, { color: sportAccent(c.sport_id) }]}>{c.name}</Text>
                        <Text style={styles.rowSub}>{String(c.type).toUpperCase()} · {c.member_count} players</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : phase === "score" ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("method")} testID="back-to-method"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>Enter Final Score</Text>
              </View>
              <View style={styles.oppCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppLabel}>YOU vs {opponent?.display_name?.toUpperCase()}</Text>
                  <Text style={styles.oppMeta}>{sportMeta?.name}</Text>
                </View>
              </View>
              <Text style={styles.scoreHelp}>Enter each {isSetSport ? "set" : "game"} score.</Text>
              {games.map((g, idx) => (
                <View key={idx} style={styles.gameRow} testID={`game-row-${idx}`}>
                  <Text style={styles.gameLabel}>{isSetSport ? "SET" : "GAME"} {idx + 1}</Text>
                  <TextInput testID={`game-a-${idx}`} style={styles.scoreInput} value={g.a}
                    onChangeText={(v) => setGames((prev) => prev.map((x, i) => i === idx ? { ...x, a: v.replace(/[^0-9]/g, "") } : x))}
                    placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" maxLength={2} />
                  <Text style={styles.dash}>—</Text>
                  <TextInput testID={`game-b-${idx}`} style={styles.scoreInput} value={g.b}
                    onChangeText={(v) => setGames((prev) => prev.map((x, i) => i === idx ? { ...x, b: v.replace(/[^0-9]/g, "") } : x))}
                    placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="number-pad" maxLength={2} />
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable testID="add-game-btn" onPress={() => setGames((prev) => [...prev, { a: "", b: "" }])} style={styles.ghostBtn}>
                  <Text style={styles.ghostBtnText}>+ ADD {isSetSport ? "SET" : "GAME"}</Text>
                </Pressable>
                {games.length > 1 && (
                  <Pressable testID="remove-game-btn" onPress={() => setGames((prev) => prev.slice(0, -1))} style={styles.ghostBtn}>
                    <Text style={styles.ghostBtnText}>− REMOVE</Text>
                  </Pressable>
                )}
              </View>
              {err && <Text style={styles.error} testID="score-error">{err}</Text>}
              <Pressable testID="preview-rating-btn" onPress={runPreview} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryBtnText}>PREVIEW RATING CHANGE →</Text>}
              </Pressable>
            </View>
          ) : preview ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("score")} testID="back-to-score"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>Review & Confirm</Text>
              </View>
              <View style={styles.tagCard}>
                <Text style={styles.tagLabel}>PROJECTION</Text>
                <Text style={styles.tagValue}>{preview.tag}</Text>
              </View>
              <View style={styles.previewGrid}>
                <View style={styles.previewCell}>
                  <Text style={styles.previewLabel}>YOUR RATING</Text>
                  <Text style={styles.previewValue}>{preview.my_rating}</Text>
                  <Text style={[styles.previewDelta, { color: preview.winner_is_me ? colors.success : colors.error }]}>
                    → {preview.new_my_rating} {preview.winner_is_me ? `(+${preview.delta})` : `(-${preview.delta})`}
                  </Text>
                </View>
                <View style={styles.previewCell}>
                  <Text style={styles.previewLabel}>OPPONENT</Text>
                  <Text style={styles.previewValue}>{preview.opponent_rating}</Text>
                  <Text style={[styles.previewDelta, { color: !preview.winner_is_me ? colors.success : colors.error }]}>
                    → {preview.new_opponent_rating} {!preview.winner_is_me ? `(+${preview.delta})` : `(-${preview.delta})`}
                  </Text>
                </View>
              </View>
              {user?.is_guest && <Text style={styles.guestWarn}>Guests can preview but not submit. Create an account to record results.</Text>}
              {err && <Text style={styles.error} testID="review-error">{err}</Text>}
              <Pressable testID="confirm-submit-btn" onPress={submit} disabled={busy || user?.is_guest} style={[styles.primaryBtn, (busy || user?.is_guest) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryBtnText}>CONFIRM & SUBMIT</Text>}
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.md, gap: 4 },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 34, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: spacing.sm },
  step: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  stepText: { ...font.textBold, fontSize: 11, color: colors.onSurface },
  stepLine: { width: 24, height: 2, backgroundColor: colors.border },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface, letterSpacing: 1 },
  rowBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: colors.border, backgroundColor: colors.surfaceSecondary },
  sportIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  rowSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  newBadge: { backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  newBadgeText: { ...font.textBold, fontSize: 9, letterSpacing: 1, color: colors.onBrand },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  hint: { ...font.text, color: colors.onSurfaceTertiary, fontSize: 13 },
  oppCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  oppLabel: { ...font.textBold, letterSpacing: 1, fontSize: 13, color: colors.onSurface },
  oppMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  matchTypeRow: { flexDirection: "row", gap: spacing.sm },
  mtBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  mtText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceTertiary },
  mtTextActive: { color: colors.onSurface },
  methodCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  methodTitle: { ...font.textBold, fontSize: 15, color: colors.onSurface, letterSpacing: 1 },
  methodSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  scoreHelp: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  gameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  gameLabel: { width: 64, ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurfaceSecondary },
  scoreInput: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingVertical: spacing.md, textAlign: "center", borderRadius: radius.md, ...font.display, fontFamily: "BarlowCondensed", fontSize: 26 },
  dash: { ...font.textBold, color: colors.onSurfaceTertiary, fontSize: 18 },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed", padding: spacing.sm, alignItems: "center", borderRadius: radius.md },
  ghostBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  primaryBtn: { backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, marginTop: spacing.sm },
  primaryBtnText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
  secondaryBtn: { flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  secondaryBtnText: { ...font.textBold, color: colors.onSurface, letterSpacing: 1, fontSize: 11 },
  error: { ...font.textMedium, color: colors.error, fontSize: 13 },
  tagCard: { padding: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", gap: 4 },
  tagLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.brand },
  tagValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  previewGrid: { flexDirection: "row", gap: spacing.sm },
  previewCell: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 4 },
  previewLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  previewValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  previewDelta: { ...font.textBold, fontSize: 13 },
  guestWarn: { ...font.textMedium, color: colors.warning, fontSize: 12 },
  successCard: { alignItems: "center", padding: spacing.xl, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  successTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface, letterSpacing: 2 },
  successSub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, textAlign: "center" },
});
