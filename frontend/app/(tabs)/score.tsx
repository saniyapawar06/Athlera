import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { ResultOverlay } from "@/src/components/ResultOverlay";
import { celebrationLevel, resultHeadline, resultSubMessage, shareFromResult } from "@/src/gamification";

type Phase = "sport" | "opponent" | "method" | "score" | "review";

export default function ScoreTab() {
  const { user } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("sport");
  const [mySports, setMySports] = useState<any[]>([]);
  const [allSports, setAllSports] = useState<any[]>([]);
  const [sportId, setSportId] = useState<string | null>(null);
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponents, setOpponents] = useState<any[]>([]);
  const [opponent, setOpponent] = useState<any | null>(null);
  const [games, setGames] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<any | null>(null);
  const [celebrate, setCelebrate] = useState<any | null>(null);
  const [shared, setShared] = useState(false);
  const [matchType, setMatchType] = useState<"oneoff" | "competition">("oneoff");
  const [myComps, setMyComps] = useState<any[]>([]);

  const sport = useMemo(() => {
    const owned = mySports.find((s) => s.sport_id === sportId);
    if (owned) return owned;
    const base = allSports.find((s) => s.id === sportId);
    if (!base) return undefined;
    return { sport_id: base.id, sport_name: base.name, rating: base.default_rating, decimals: base.decimals, accent: base.accent, rank: "—", provisional: true };
  }, [mySports, allSports, sportId]);

  // Merge the 5 canonical sports with the player's own cards so every sport is
  // scorable — even ones the athlete has never played (auto-provisioned on pick).
  const displaySports = useMemo(() => {
    return allSports.map((s) => {
      const owned = mySports.find((c) => c.sport_id === s.id);
      return owned
        ? { ...owned, isNew: false }
        : { sport_id: s.id, sport_name: s.name, rating: s.default_rating, decimals: s.decimals, accent: s.accent, rank: "—", isNew: true };
    });
  }, [allSports, mySports]);

  const loadMine = useCallback(async () => {
    try { const d = await api.dashboard(); setMySports(d.cards || []); } catch { /* noop */ }
  }, []);

  useEffect(() => { loadMine(); }, [loadMine]);

  useEffect(() => {
    (async () => {
      try { const s = await api.sports(); setAllSports(s.sports || []); } catch { /* noop */ }
    })();
  }, []);

  const pickSport = async (s: any) => {
    setErr(null);
    setSportId(s.sport_id);
    setPhase("opponent");
    if (s.isNew && !user?.is_guest) {
      // Auto-create the sport profile with a provisional rating — no re-onboarding.
      try { await api.ensureSport(s.sport_id); await loadMine(); } catch { /* noop */ }
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const c = await api.compMine();
        // Show competitions relevant for scoring: any the user organises (they can
        // score fixtures between other participants) or any that already have fixtures.
        setMyComps((c.competitions || []).filter((x: any) => x.fixtures_generated || x.is_organiser || x.my_role === "organiser"));
      } catch { /* noop */ }
    })();
  }, []);

  useEffect(() => {
    if (!sportId) { setOpponents([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.opponents(sportId, opponentQuery);
        setOpponents(r.opponents || []);
      } catch { /* noop */ }
    }, 200);
    return () => clearTimeout(t);
  }, [sportId, opponentQuery]);

  const reset = () => {
    setPhase("sport"); setSportId(null); setOpponent(null);
    setGames([{ a: "", b: "" }]); setPreview(null); setSubmitted(null); setErr(null);
    setCelebrate(null); setShared(false);
  };

  const runPreview = async () => {
    setErr(null); setBusy(true);
    try {
      const parsedGames = games
        .filter((g) => g.a !== "" && g.b !== "")
        .map((g) => [Number(g.a), Number(g.b)]);
      if (parsedGames.length === 0) { setErr("Enter at least one game"); return; }
      const p = await api.matchPreview({ sport_id: sportId!, opponent_user_id: opponent.user_id, games: parsedGames });
      setPreview(p);
      setPhase("review");
    } catch (e: any) {
      setErr(e?.message || "Preview failed");
    } finally { setBusy(false); }
  };

  const bump = (idx: number, side: "a" | "b", d: number) =>
    setGames((prev) => prev.map((x, i) => {
      if (i !== idx) return x;
      const cur = Number(x[side] || 0);
      const next = Math.max(0, Math.min(99, cur + d));
      return { ...x, [side]: String(next) };
    }));

  const submit = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const parsedGames = games
        .filter((g) => g.a !== "" && g.b !== "")
        .map((g) => [Number(g.a), Number(g.b)]);
      const res = await api.matchSubmit({ sport_id: sportId!, opponent_user_id: opponent.user_id, games: parsedGames });
      const rc = res.rating_change;
      if (rc && Object.keys(rc).length > 0) {
        setCelebrate({ rc, won: !!rc.is_winner, form: sport?.recent_form || [] });
      } else {
        setSubmitted(res.match);
      }
    } catch (e: any) {
      setErr(e?.message || "Submit failed");
    } finally { setBusy(false); }
  };

  const doShare = async () => {
    if (!celebrate) return;
    const body = shareFromResult(celebrate.rc, { id: sportId!, name: sport?.sport_name || "" }, celebrate.won);
    if (body) { try { await api.shareToFeed(body); } catch { /* noop */ } }
    setShared(true);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="score-screen">
      <View style={styles.header}>
        <Text style={styles.title}>SCORE MATCH</Text>
        <Text style={styles.subtitle}>Sport → Opponent → Live or Final score</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!submitted && (
            <View style={styles.matchTypeRow}>
              {(["oneoff", "competition"] as const).map((t) => (
                <Pressable key={t} testID={`match-type-${t}`} onPress={() => setMatchType(t)} style={[styles.mtBtn, matchType === t && styles.mtBtnActive]}>
                  <Text style={[styles.mtText, matchType === t && styles.mtTextActive]}>{t === "oneoff" ? "ONE-OFF MATCH" : "COMPETITION"}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {matchType === "competition" && !submitted ? (
            <View style={styles.section} testID="comp-result-picker">
              <Text style={styles.sectionTitle}>Pick a competition</Text>
              <Text style={styles.hint}>Open a competition to enter or live-score its fixtures. Organisers can score any fixture.</Text>
              {myComps.length === 0 ? (
                <View style={styles.emptyComp} testID="no-comps-empty">
                  <Text style={styles.hint}>No competitions to score yet.</Text>
                  <Pressable testID="create-comp-cta" onPress={() => router.push("/competition/create?sport_id=squash&type=league")} style={styles.emptyCompCta}>
                    <Text style={styles.emptyCompCtaText}>CREATE LEAGUE / KNOCKOUT →</Text>
                  </Pressable>
                </View>
              ) : myComps.map((c) => (
                <Pressable key={c.id} testID={`comp-result-${c.id}`} onPress={() => router.push(`/competition/${c.id}`)} style={({ pressed }) => [styles.rowBtn, { borderLeftColor: sportAccent(c.sport_id) }, pressed && { opacity: 0.85 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: sportAccent(c.sport_id) }]}>{c.name}</Text>
                    <Text style={styles.rowSub}>{c.type.toUpperCase()} · {c.member_count} players · {String(c.status).replace(/_/g, " ")}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          ) : (
          <>
          {/* Stepper */}
          <View style={styles.stepper}>
            {(["sport", "opponent", "score", "review"] as Phase[]).map((p, i) => {
              const order = ["sport", "opponent", "method", "score", "review"];
              const currentIdx = order.indexOf(phase);
              const active = order.indexOf(p) <= currentIdx || (p === "opponent" && phase === "method");
              return (
                <React.Fragment key={p}>
                  <View style={[styles.step, active && styles.stepActive]}>
                    <Text style={styles.stepText}>{i + 1}</Text>
                  </View>
                  {i < 3 && <View style={styles.stepLine} />}
                </React.Fragment>
              );
            })}
          </View>

          {submitted ? (
            <Animated.View entering={FadeIn.duration(400)} style={styles.successCard} testID="match-submitted">
              <Ionicons name="checkmark-circle" size={48} color={colors.success} />
              <Text style={styles.successTitle}>MATCH RECORDED</Text>
              <Text style={styles.successSub}>
                {submitted.status === "verified" ? "Verified — ratings updated." : "Pending opponent confirmation."}
              </Text>
              <Pressable onPress={reset} style={styles.primaryBtn} testID="new-match-btn">
                <Text style={styles.primaryBtnText}>NEW MATCH</Text>
              </Pressable>
            </Animated.View>
          ) : phase === "sport" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>1 · Which sport?</Text>
              <Text style={styles.hint}>Play any of the five ATHLERA sports. New sports get a provisional rating instantly.</Text>
              {displaySports.map((s) => (
                <Pressable
                  key={s.sport_id}
                  testID={`pick-sport-${s.sport_id}`}
                  onPress={() => pickSport(s)}
                  style={({ pressed }) => [styles.rowBtn, { borderLeftColor: s.accent }, pressed && { opacity: 0.85 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: s.accent }]}>{s.sport_name.toUpperCase()}</Text>
                    <Text style={styles.rowSub}>
                      {s.isNew ? "New sport · provisional rating on first play" : `Your rating: ${formatRating(s.rating, s.decimals)} · Rank #${s.rank}`}
                    </Text>
                  </View>
                  {s.isNew && <View style={styles.newTag}><Text style={styles.newTagText}>NEW</Text></View>}
                  <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
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
                    <Text style={styles.rowSub}>{o.city || "—"} · Rating {o.rating}{o.provisional ? " (P)" : ""}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
              {opponents.length === 0 && (
                <Text style={styles.hint}>No opponents match — try a different name.</Text>
              )}
            </View>
          ) : phase === "method" ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("opponent")} testID="back-to-opponent-method"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>3 · How do you want to score?</Text>
              </View>
              <View style={styles.oppCard} testID="method-opp-summary">
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppLabel}>YOU vs {opponent?.display_name?.toUpperCase()}</Text>
                  <Text style={styles.oppMeta}>{sport?.sport_name} · {opponent?.city || "—"}</Text>
                </View>
              </View>
              <Pressable
                testID="method-live"
                onPress={() => router.push(`/live/setup?sport_id=${sportId}&opp_id=${opponent.user_id}&opp_name=${encodeURIComponent(opponent.display_name)}`)}
                style={({ pressed }) => [styles.methodBtn, { borderColor: colors.brand }, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="radio" size={26} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodTitle}>LIVE SCORE</Text>
                  <Text style={styles.methodSub}>Point-by-point live scoreboard with Undo & resume</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Pressable
                testID="method-final"
                onPress={() => setPhase("score")}
                style={({ pressed }) => [styles.methodBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="create" size={26} color={colors.onSurface} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.methodTitle}>ENTER FINAL SCORE</Text>
                  <Text style={styles.methodSub}>Record a completed result with a rating preview</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>
          ) : phase === "score" ? (
            <View style={styles.section}>
              <View style={styles.rowHeader}>
                <Pressable onPress={() => setPhase("method")} testID="back-to-opponent"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
                <Text style={styles.sectionTitle}>3 · Enter Score</Text>
              </View>
              <View style={styles.oppCard} testID="score-opp-summary">
                <View style={{ flex: 1 }}>
                  <Text style={styles.oppLabel}>YOU vs {opponent?.display_name?.toUpperCase()}</Text>
                  <Text style={styles.oppMeta}>{sport?.sport_name} · Rating {formatRating(sport?.rating, sport?.decimals)} vs {opponent?.rating}</Text>
                </View>
              </View>
              <View style={styles.scoreSummary} testID="score-summary">
                <View style={styles.ssCol}>
                  <Text style={styles.ssName} numberOfLines={1}>YOU</Text>
                  <Text style={[styles.ssVal, { color: sportAccent(sport?.sport_id) }]}>{games.filter((g) => g.a !== "" && g.b !== "" && Number(g.a) > Number(g.b)).length}</Text>
                </View>
                <Text style={styles.ssDash}>—</Text>
                <View style={styles.ssCol}>
                  <Text style={styles.ssName} numberOfLines={1}>{opponent?.display_name?.split(" ")[0]?.toUpperCase() || "OPP"}</Text>
                  <Text style={styles.ssVal}>{games.filter((g) => g.a !== "" && g.b !== "" && Number(g.b) > Number(g.a)).length}</Text>
                </View>
              </View>
              <Text style={styles.scoreHelp}>Tap +/− or type each {sport?.sport_id === "tennis" || sport?.sport_id === "padel" ? "set" : "game"} score.</Text>
              {games.map((g, idx) => (
                <View key={idx} style={styles.gameRow} testID={`game-row-${idx}`}>
                  <Text style={styles.gameLabel}>{sport?.sport_id === "tennis" || sport?.sport_id === "padel" ? "SET" : "GAME"} {idx + 1}</Text>
                  <View style={styles.stepGroup}>
                    <Pressable testID={`game-a-minus-${idx}`} onPress={() => bump(idx, "a", -1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="remove" size={18} color={colors.onSurface} /></Pressable>
                    <TextInput
                      testID={`game-a-${idx}`}
                      style={styles.scoreInputSm}
                      value={g.a}
                      onChangeText={(v) => setGames((prev) => prev.map((x, i) => i === idx ? { ...x, a: v.replace(/[^0-9]/g, "") } : x))}
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <Pressable testID={`game-a-plus-${idx}`} onPress={() => bump(idx, "a", 1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="add" size={18} color={colors.onSurface} /></Pressable>
                  </View>
                  <Text style={styles.dash}>—</Text>
                  <View style={styles.stepGroup}>
                    <Pressable testID={`game-b-minus-${idx}`} onPress={() => bump(idx, "b", -1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="remove" size={18} color={colors.onSurface} /></Pressable>
                    <TextInput
                      testID={`game-b-${idx}`}
                      style={styles.scoreInputSm}
                      value={g.b}
                      onChangeText={(v) => setGames((prev) => prev.map((x, i) => i === idx ? { ...x, b: v.replace(/[^0-9]/g, "") } : x))}
                      placeholder="0"
                      placeholderTextColor={colors.onSurfaceTertiary}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <Pressable testID={`game-b-plus-${idx}`} onPress={() => bump(idx, "b", 1)} hitSlop={6} style={styles.stepBtn}><Ionicons name="add" size={18} color={colors.onSurface} /></Pressable>
                  </View>
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Pressable testID="add-game-btn" onPress={() => setGames((prev) => [...prev, { a: "", b: "" }])} style={styles.ghostBtn}>
                  <Text style={styles.ghostBtnText}>+ ADD {sport?.sport_id === "tennis" || sport?.sport_id === "padel" ? "SET" : "GAME"}</Text>
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
                <Text style={styles.sectionTitle}>4 · Review & Confirm</Text>
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
              <View style={styles.metaRow}>
                <View style={styles.metaBox}>
                  <Text style={styles.metaLabel}>WIN PROB</Text>
                  <Text style={styles.metaVal}>{Math.round(preview.expected_winner_prob * 100)}%</Text>
                </View>
                <View style={styles.metaBox}>
                  <Text style={styles.metaLabel}>DOMINANCE</Text>
                  <Text style={styles.metaVal}>{Math.round(preview.margin_score * 100)}%</Text>
                </View>
                <View style={styles.metaBox}>
                  <Text style={styles.metaLabel}>WINNER</Text>
                  <Text style={styles.metaVal}>{preview.winner_is_me ? "YOU" : "OPP"}</Text>
                </View>
              </View>
              {user?.is_guest && (
                <Text style={styles.guestWarn}>Guests can preview but not submit verified matches. Create an account to record results.</Text>
              )}
              {err && <Text style={styles.error} testID="review-error">{err}</Text>}
              <Pressable
                testID="confirm-submit-btn"
                onPress={submit}
                disabled={busy || user?.is_guest}
                style={[styles.primaryBtn, (busy || user?.is_guest) && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryBtnText}>CONFIRM & SUBMIT</Text>}
              </Pressable>
            </View>
          ) : null}
          </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {celebrate && (
        <ResultOverlay
          visible
          won={celebrate.won}
          level={celebrationLevel(celebrate.rc, false)}
          accent={sportAccent(sportId || "")}
          headline={resultHeadline(celebrate.rc, celebrate.won, false)}
          subMessage={resultSubMessage(celebrate.rc, celebrate.won, celebrate.form)}
          before={celebrate.rc.before}
          after={celebrate.rc.after}
          delta={celebrate.rc.delta}
          formDots={celebrate.won ? [] : celebrate.form}
          onShare={doShare}
          shared={shared}
          onContinue={() => { setCelebrate(null); reset(); }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.md, gap: 4 },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  matchTypeRow: { flexDirection: "row", gap: spacing.sm },
  mtBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  mtBtnActive: { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary },
  mtText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceTertiary },
  mtTextActive: { color: colors.onSurface },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: spacing.sm },
  step: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  stepActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  stepText: { ...font.textBold, fontSize: 12, color: colors.onSurface },
  stepLine: { width: 24, height: 2, backgroundColor: colors.border },
  section: { gap: spacing.sm },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  rowBtn: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderLeftWidth: 4, borderLeftColor: colors.border, backgroundColor: colors.surfaceSecondary },
  rowTitle: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  rowSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  newTag: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginRight: 6 },
  newTagText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.brand },
  methodBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  methodTitle: { ...font.textBold, fontSize: 15, color: colors.onSurface, letterSpacing: 1 },
  methodSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  hint: { ...font.text, color: colors.onSurfaceTertiary, fontSize: 13 },
  oppCard: { flexDirection: "row", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  oppLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 12, color: colors.onSurface },
  oppMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  scoreHelp: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  gameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  gameLabel: { width: 52, ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurfaceSecondary },
  stepGroup: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 34, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  scoreInputSm: { flex: 1, minWidth: 40, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingVertical: spacing.sm, textAlign: "center", borderRadius: radius.md, ...font.display, fontFamily: "BarlowCondensed", fontSize: 26 },
  scoreSummary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  ssCol: { alignItems: "center", flex: 1 },
  ssName: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  ssVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 40, color: colors.onSurface, lineHeight: 44 },
  ssDash: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurfaceTertiary },
  scoreInput: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingVertical: spacing.md, textAlign: "center", borderRadius: radius.md, ...font.display, fontFamily: "BarlowCondensed", fontSize: 26 },
  dash: { ...font.textBold, color: colors.onSurfaceTertiary, fontSize: 18 },
  ghostBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed", padding: spacing.sm, alignItems: "center", borderRadius: radius.md },
  ghostBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  primaryBtn: { backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md, marginTop: spacing.sm },
  primaryBtnText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
  error: { ...font.textMedium, color: colors.error, fontSize: 13 },
  tagCard: { padding: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", gap: 4 },
  tagLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.brand },
  tagValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  previewGrid: { flexDirection: "row", gap: spacing.sm },
  previewCell: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 4 },
  previewLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  previewValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  previewDelta: { ...font.textBold, fontSize: 13 },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaBox: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  metaLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 9, color: colors.onSurfaceTertiary },
  metaVal: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface, marginTop: 2 },
  guestWarn: { ...font.textMedium, color: colors.warning, fontSize: 12 },
  successCard: { alignItems: "center", padding: spacing.xl, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  successTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface, letterSpacing: 2 },
  successSub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, textAlign: "center" },
  emptyComp: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  emptyCompCta: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingVertical: spacing.sm, alignItems: "center" },
  emptyCompCtaText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.brand },
});
