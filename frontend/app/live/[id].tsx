import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { ResultOverlay } from "@/src/components/ResultOverlay";
import { celebrationLevel, resultHeadline, resultSubMessage, shareFromResult } from "@/src/gamification";
import { useAuth } from "@/src/auth-context";

export default function LiveScorerScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [disp, setDisp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [warmupLeft, setWarmupLeft] = useState(0);
  const [interval, setIntervalShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [shared, setShared] = useState(false);
  const prevGames = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await api.liveGet(id as string);
      setData(d); setDisp(d.display);
      prevGames.current = (d.display.completed_games || []).length;
      if (d.warmup_seconds > 0) setWarmupLeft(d.warmup_seconds);
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (warmupLeft <= 0) return;
    const t = setInterval(() => setWarmupLeft((w) => (w <= 1 ? 0 : w - 1)), 1000);
    return () => clearInterval(t);
  }, [warmupLeft > 0]);

  const accent = sportAccent(data?.sport?.id || "");

  const send = async (type: string, side?: number) => {
    if (busy || warmupLeft > 0) return;
    setBusy(true);
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    try {
      const r = await api.liveEvent(id as string, type, side);
      setDisp(r.display);
      const newGames = (r.display.completed_games || []).length;
      if (r.completed) {
        // finalize
        const fin = await api.liveFinalize(id as string);
        setFinalResult(fin);
      } else if (newGames > prevGames.current) {
        prevGames.current = newGames;
        setIntervalShown(true);
      }
    } catch (e) { /* ignore */ } finally { setBusy(false); }
  };

  const abandon = async () => {
    await api.liveAbandon(id as string);
    router.back();
  };

  if (loading || !data || !disp) {
    return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  const sides = data.sides;
  const isSet = disp.kind === "set";
  const pointsDisplay = isSet ? disp.points_display : (disp.points || [0, 0]).map((x: number) => String(x));

  // gamification headline
  const buildOverlay = () => {
    const rc = finalResult.rating_changes?.[user?.id || ""] || {};
    const won = finalResult.winner_side != null && sides[finalResult.winner_side].user_ids.includes(user?.id);
    const isComp = !!finalResult.competition_id;
    return {
      rc, won, isComp,
      level: celebrationLevel(rc, isComp),
      headline: resultHeadline(rc, won, isComp),
      subMessage: resultSubMessage(rc, won, []),
      before: rc.before ?? null, after: rc.after ?? null, delta: rc.delta ?? null,
      achievements: rc.achievements || [],
    };
  };

  const doShare = async () => {
    const o = buildOverlay();
    const body = shareFromResult(o.rc, { id: data.sport.id, name: data.sport.name }, o.won, o.isComp);
    if (body) { try { await api.shareToFeed(body); } catch { /* noop */ } }
    setShared(true);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="live-scorer-screen">
      <View style={styles.header}>
        <Text style={[styles.sport, { color: accent }]}>{data.sport.name.toUpperCase()} · BO{disp.best_of}</Text>
        <Pressable testID="abandon-btn" onPress={abandon} hitSlop={12}><Text style={styles.abandon}>ABANDON</Text></Pressable>
      </View>

      {/* completed games strip */}
      <View style={styles.gamesStrip}>
        {(disp.completed_games || []).map((g: number[], i: number) => (
          <View key={i} style={styles.gamePill}><Text style={styles.gamePillText}>{g[0]}-{g[1]}</Text></View>
        ))}
        {disp.tiebreak && <View style={[styles.gamePill, { borderColor: accent }]}><Text style={[styles.gamePillText, { color: accent }]}>TB</Text></View>}
      </View>

      {/* score panels */}
      <View style={styles.panels}>
        {[0, 1].map((s) => {
          const serving = disp.server_side === s;
          return (
            <Pressable
              key={s}
              testID={`score-side-${s}`}
              onPress={() => send("rally_won", s)}
              style={({ pressed }) => [styles.panel, { borderColor: serving ? accent : colors.border }, pressed && { backgroundColor: colors.surfaceTertiary }]}
            >
              <View style={styles.panelTop}>
                <Text style={styles.sideName} numberOfLines={1}>{sides[s].label}</Text>
                {serving && <View style={[styles.serveDot, { backgroundColor: accent }]} />}
              </View>
              <Text style={[styles.bigScore, { color: serving ? accent : colors.onSurface }]}>{pointsDisplay[s]}</Text>
              <Text style={styles.setsWon}>{isSet ? "SETS" : "GAMES"} {disp.games_won[s]}</Text>
              {data.sport.id === "pickleball" && s === disp.server_side && disp.score_call && (
                <Text style={styles.scoreCall}>{disp.score_call}</Text>
              )}
              <Text style={styles.tapHint}>TAP = POINT</Text>
            </Pressable>
          );
        })}
      </View>

      {/* controls */}
      <View style={styles.controls}>
        {(data.sport.id === "squash" || data.sport.id === "badminton") && (
          <Pressable testID="ctrl-let" onPress={() => send("let")} style={styles.ctrlBtn}>
            <Text style={styles.ctrlText}>LET (REPLAY)</Text>
          </Pressable>
        )}
        {data.sport.id === "pickleball" && (
          <Pressable testID="ctrl-replay" onPress={() => send("replay")} style={styles.ctrlBtn}>
            <Text style={styles.ctrlText}>REPLAY</Text>
          </Pressable>
        )}
        {(data.sport.id === "tennis" || data.sport.id === "padel") && (
          <Pressable testID="ctrl-let" onPress={() => send("service_let")} style={styles.ctrlBtn}>
            <Text style={styles.ctrlText}>SERVICE LET</Text>
          </Pressable>
        )}
        <Pressable testID="ctrl-undo" onPress={() => send("undo")} style={[styles.ctrlBtn, { borderColor: colors.warning }]}>
          <Ionicons name="arrow-undo" size={16} color={colors.warning} />
          <Text style={[styles.ctrlText, { color: colors.warning }]}>UNDO</Text>
        </Pressable>
      </View>

      {/* referee event chips */}
      <View style={styles.refWrap}>
        <Text style={styles.refLabel}>REFEREE EVENTS (award to serving side unless faulted)</Text>
        <View style={styles.refRow}>
          {data.sport.id === "squash" && ["stroke", "tin", "out", "service_fault", "no_let"].map((e) => (
            <Pressable key={e} testID={`ref-${e}`} onPress={() => send(e)} style={styles.refChip}><Text style={styles.refChipText}>{e.replace("_", " ").toUpperCase()}</Text></Pressable>
          ))}
          {data.sport.id === "badminton" && ["service_fault", "fault", "shuttle_out"].map((e) => (
            <Pressable key={e} testID={`ref-${e}`} onPress={() => send(e)} style={styles.refChip}><Text style={styles.refChipText}>{e.replace("_", " ").toUpperCase()}</Text></Pressable>
          ))}
          {data.sport.id === "pickleball" && ["service_fault", "kitchen_fault", "ball_out", "double_bounce_fault"].map((e) => (
            <Pressable key={e} testID={`ref-${e}`} onPress={() => send(e)} style={styles.refChip}><Text style={styles.refChipText}>{e.replace(/_/g, " ").toUpperCase()}</Text></Pressable>
          ))}
          {(data.sport.id === "tennis" || data.sport.id === "padel") && ["ace", "double_fault", "winner", "unforced_error"].map((e) => (
            <Pressable key={e} testID={`ref-${e}`} onPress={() => send(e)} style={styles.refChip}><Text style={styles.refChipText}>{e.replace(/_/g, " ").toUpperCase()}</Text></Pressable>
          ))}
        </View>
      </View>

      {/* Warm-up overlay */}
      {warmupLeft > 0 && (
        <View style={styles.overlay} testID="warmup-overlay">
          <Text style={styles.overlayLabel}>WARM-UP</Text>
          <Text style={[styles.overlayBig, { color: accent }]}>{warmupLeft}s</Text>
          <Pressable testID="skip-warmup" onPress={() => setWarmupLeft(0)} style={[styles.overlayBtn, { borderColor: accent }]}>
            <Text style={[styles.overlayBtnText, { color: accent }]}>SKIP & START</Text>
          </Pressable>
        </View>
      )}

      {/* Game interval overlay */}
      {interval && !finalResult && (
        <Animated.View entering={FadeIn} style={styles.overlay} testID="interval-overlay">
          <Text style={styles.overlayLabel}>{isSet ? "SET" : "GAME"} COMPLETE</Text>
          <Text style={[styles.overlayBig, { color: accent }]}>{disp.games_won[0]} — {disp.games_won[1]}</Text>
          <Pressable testID="next-game-btn" onPress={() => setIntervalShown(false)} style={[styles.overlayBtn, { borderColor: accent }]}>
            <Text style={[styles.overlayBtnText, { color: accent }]}>START NEXT {isSet ? "SET" : "GAME"}</Text>
          </Pressable>
        </Animated.View>
      )}

      {finalResult && (() => {
        const o = buildOverlay();
        const scoreTag = (finalResult.games || []).map((g: number[]) => `${g[0]}-${g[1]}`).join(" · ");
        return (
          <ResultOverlay
            visible
            won={o.won}
            level={o.level}
            accent={accent}
            headline={o.headline}
            subMessage={o.subMessage}
            before={o.before}
            after={o.after}
            delta={o.delta}
            tag={scoreTag}
            achievements={o.achievements}
            onShare={doShare}
            shared={shared}
            onContinue={() => router.replace(`/sport/${data.sport.id}`)}
          />
        );
      })()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  sport: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, letterSpacing: 2 },
  abandon: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.error },
  gamesStrip: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 30, flexWrap: "wrap" },
  gamePill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  gamePillText: { ...font.textBold, fontSize: 12, color: colors.onSurfaceSecondary },
  panels: { flex: 1, flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  panel: { flex: 1, borderWidth: 2, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, padding: spacing.sm, gap: 4 },
  panelTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideName: { ...font.textBold, fontSize: 13, color: colors.onSurface, maxWidth: 130 },
  serveDot: { width: 8, height: 8, borderRadius: 4 },
  bigScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 96, lineHeight: 100 },
  setsWon: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  scoreCall: { ...font.textBold, fontSize: 12, color: colors.onSurfaceTertiary },
  tapHint: { ...font.textBold, letterSpacing: 2, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 4 },
  controls: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md },
  ctrlBtn: { flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  ctrlText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  refWrap: { padding: spacing.md, gap: spacing.sm },
  refLabel: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  refRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  refChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.surfaceSecondary },
  refChipText: { ...font.textBold, letterSpacing: 0.5, fontSize: 9, color: colors.onSurfaceSecondary },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,10,0.94)", alignItems: "center", justifyContent: "center", gap: spacing.md },
  overlayLabel: { ...font.textBold, letterSpacing: 3, fontSize: 12, color: colors.onSurfaceSecondary },
  overlayBig: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 72 },
  overlayBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  overlayBtnText: { ...font.textBold, letterSpacing: 2, fontSize: 13 },
});
