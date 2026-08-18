import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { ResultOverlay } from "@/src/components/ResultOverlay";
import { useAuth } from "@/src/auth-context";
import { newState, applyLocal, display as engineDisplay, SPORT_RULES } from "@/src/live-engine";

type LogEntry = { id: number; text: string };

export default function LiveScorerScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveId = id as string;

  const engineRef = useRef<any>(null);
  const queueRef = useRef<{ type: string; side?: number; note?: string }[]>([]);
  const processingRef = useRef(false);
  const logSeq = useRef(0);

  const [meta, setMeta] = useState<{ sport: any; sides: any[] } | null>(null);
  const [disp, setDisp] = useState<any>(null);
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [finalizing, setFinalizing] = useState(false);

  // ---- hydrate once ----
  useEffect(() => {
    (async () => {
      try {
        const d = await api.liveGet(liveId);
        const st = d.state
          ? { ...d.state, log: [] }
          : newState(d.sport.id, d.sides, d.display.best_of, d.display.doubles, d.display.server_side ?? 0, {});
        engineRef.current = st;
        setMeta({ sport: d.sport, sides: d.sides });
        setDisp(engineDisplay(st));
      } finally { setLoading(false); }
    })();
  }, [liveId]);

  const sportId: string = meta?.sport?.id || "";
  const accent = sportAccent(sportId);
  const sportKind = sportId ? SPORT_RULES[sportId]?.kind : "point";

  // ---- async sync worker (never blocks UI) ----
  const backendType = useCallback((kind: "point" | "replay" | "undo") => {
    if (kind === "undo") return "undo";
    if (kind === "replay") return sportId === "pickleball" ? "replay" : sportKind === "set" ? "service_let" : "let";
    return sportKind === "set" ? "point_won" : "rally_won";
  }, [sportId, sportKind]);

  const pump = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setSyncing(queueRef.current.length > 0);
    while (queueRef.current.length) {
      const ev = queueRef.current[0];
      try {
        await api.liveEvent(liveId, ev.type, ev.side, ev.note);
        queueRef.current.shift();
        setSyncing(queueRef.current.length > 0);
      } catch {
        // weak connectivity: keep queued, retry shortly
        processingRef.current = false;
        setTimeout(pump, 1500);
        return;
      }
    }
    processingRef.current = false;
    setSyncing(false);
  }, [liveId]);

  const enqueue = useCallback((kind: "point" | "replay" | "undo", side?: number) => {
    queueRef.current.push({ type: backendType(kind), side });
    pump();
  }, [backendType, pump]);

  const pushLog = useCallback((text: string) => {
    logSeq.current += 1;
    const entry = { id: logSeq.current, text };
    setEvents((prev) => [...prev.slice(-19), entry]);
  }, []);

  // ---- optimistic action ----
  const act = useCallback((kind: "point" | "replay" | "undo", side?: number, logText?: string) => {
    const st = engineRef.current;
    if (!st) return;
    if (kind !== "undo" && st.status === "completed") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    engineRef.current = applyLocal(st, kind, side);
    const nd = engineDisplay(engineRef.current);
    setDisp(nd);
    if (kind === "undo") { setEvents((prev) => prev.slice(0, -1)); }
    else if (logText) pushLog(logText);
    enqueue(kind, side);

    if (nd.status === "completed") {
      setFinalizing(true);
      (async () => {
        // ensure all events synced, then finalize authoritatively on server
        while (queueRef.current.length) { await new Promise((r) => setTimeout(r, 120)); }
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          const fin = await api.liveFinalize(liveId);
          setFinalResult(fin);
        } finally { setFinalizing(false); }
      })();
    }
  }, [enqueue, pushLog, liveId]);

  const abandon = useCallback(async () => {
    try { await api.liveAbandon(liveId); } catch {}
    router.back();
  }, [liveId, router]);

  const nameOf = useCallback((s: number) => (meta?.sides?.[s]?.label || `Side ${s + 1}`), [meta]);

  // ---- action helpers ----
  const point = useCallback((s: number) => act("point", s, `Point — ${nameOf(s)}`), [act, nameOf]);
  const stroke = useCallback((s: number) => act("point", s, `Stroke to ${nameOf(s)}`), [act, nameOf]);
  const noLet = useCallback((s: number) => act("point", 1 - s, `No Let against ${nameOf(s)} → point ${nameOf(1 - s)}`), [act, nameOf]);
  const letReplay = useCallback((s?: number) => act("replay", undefined, s != null ? `Let — replay (${nameOf(s)})` : "Let — replay"), [act, nameOf]);
  const undo = useCallback(() => act("undo"), [act]);

  const buildOverlay = () => {
    const rc = finalResult.rating_changes?.[user?.id || ""] || {};
    const won = finalResult.winner_side != null && meta!.sides[finalResult.winner_side].user_ids.includes(user?.id);
    let headline = won ? "KEEP IT UP" : "BETTER LUCK NEXT TIME";
    if (rc.level_up) headline = "LEVEL UP";
    else if (rc.new_peak) headline = "NEW PERSONAL BEST";
    else if (won && rc.streak >= 3) headline = `${rc.streak} MATCH STREAK`;
    else if (won) headline = "WELL PLAYED";
    return { won, headline, before: rc.before ?? null, after: rc.after ?? null, delta: rc.delta ?? null };
  };

  if (loading || !meta || !disp) {
    return <SafeAreaView style={styles.root}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;
  }

  const isSet = disp.kind === "set";
  const pointsDisplay = isSet ? disp.points_display : (disp.points || [0, 0]).map((x: number) => String(x));
  const isSquash = sportId === "squash";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="live-scorer-screen">
      <View style={styles.header}>
        <Text style={[styles.sport, { color: accent }]}>{meta.sport.name.toUpperCase()} · BO{disp.best_of}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {syncing && <View style={styles.syncPill} testID="sync-indicator"><ActivityIndicator size="small" color={colors.onSurfaceTertiary} /><Text style={styles.syncText}>SYNCING</Text></View>}
          <Pressable testID="abandon-btn" onPress={abandon} hitSlop={12}><Text style={styles.abandon}>ABANDON</Text></Pressable>
        </View>
      </View>

      {/* completed games strip */}
      <View style={styles.gamesStrip}>
        {(disp.completed_games || []).map((g: number[], i: number) => (
          <View key={i} style={styles.gamePill}><Text style={styles.gamePillText}>{g[0]}-{g[1]}</Text></View>
        ))}
        {isSet && !!disp.cur_games && (disp.cur_games[0] || disp.cur_games[1]) ? (
          <View style={[styles.gamePill, { borderColor: accent }]}><Text style={[styles.gamePillText, { color: accent }]}>GMS {disp.cur_games[0]}-{disp.cur_games[1]}</Text></View>
        ) : null}
        {disp.tiebreak && <View style={[styles.gamePill, { borderColor: accent }]}><Text style={[styles.gamePillText, { color: accent }]}>TIEBREAK</Text></View>}
      </View>

      {/* score panels */}
      <View style={styles.panels}>
        {[0, 1].map((s) => {
          const serving = disp.server_side === s;
          return (
            <ScorePanel
              key={s}
              side={s}
              name={meta.sides[s].label}
              score={pointsDisplay[s]}
              unitsLabel={isSet ? "SETS" : "GAMES"}
              units={disp.games_won[s]}
              serving={serving}
              accent={accent}
              scoreCall={sportId === "pickleball" && s === disp.server_side ? disp.score_call : null}
              onPoint={point}
            />
          );
        })}
      </View>

      {/* squash player-specific referee actions */}
      {isSquash ? (
        <View style={styles.refZone}>
          {[0, 1].map((s) => (
            <View key={s} style={styles.refCol}>
              <Text style={styles.refWho} numberOfLines={1}>{meta.sides[s].label}</Text>
              <View style={styles.refBtnRow}>
                <Pressable testID={`stroke-${s}`} onPress={() => stroke(s)} style={[styles.refBtn, { borderColor: colors.success }]}><Text style={[styles.refBtnText, { color: colors.success }]}>STROKE</Text></Pressable>
                <Pressable testID={`nolet-${s}`} onPress={() => noLet(s)} style={[styles.refBtn, { borderColor: colors.error }]}><Text style={[styles.refBtnText, { color: colors.error }]}>NO LET</Text></Pressable>
                <Pressable testID={`let-${s}`} onPress={() => letReplay(s)} style={styles.refBtn}><Text style={styles.refBtnText}>LET</Text></Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.controls}>
          <Pressable testID="ctrl-replay" onPress={() => letReplay()} style={styles.ctrlBtn}>
            <Ionicons name="repeat" size={16} color={colors.onSurfaceSecondary} />
            <Text style={styles.ctrlText}>{sportKind === "set" ? "SERVICE LET" : "LET / REPLAY"}</Text>
          </Pressable>
        </View>
      )}

      {/* undo + event log */}
      <View style={styles.controls}>
        <Pressable testID="ctrl-undo" onPress={undo} style={[styles.ctrlBtn, styles.undoBtn]}>
          <Ionicons name="arrow-undo" size={18} color={colors.warning} />
          <Text style={[styles.ctrlText, { color: colors.warning }]}>UNDO LAST ACTION</Text>
        </Pressable>
      </View>

      <View style={styles.eventLog} testID="live-event-log">
        <Text style={styles.refLabel}>MATCH EVENTS</Text>
        <ScrollView style={{ maxHeight: 96 }} showsVerticalScrollIndicator={false}>
          {events.length === 0 ? <Text style={styles.eventText}>Tap a player to score. Actions appear here.</Text> :
            [...events].reverse().map((e) => <Text key={e.id} style={styles.eventText}>{e.text}</Text>)}
        </ScrollView>
      </View>

      {(finalResult || finalizing) && finalResult && (() => {
        const o = buildOverlay();
        const scoreTag = (finalResult.games || []).map((g: number[]) => `${g[0]}-${g[1]}`).join(" · ");
        return (
          <ResultOverlay visible won={o.won} headline={o.headline} before={o.before} after={o.after} delta={o.delta} tag={scoreTag}
            onContinue={() => router.replace(`/sport/${sportId}`)} />
        );
      })()}
    </SafeAreaView>
  );
}

const ScorePanel = React.memo(function ScorePanel({ side, name, score, unitsLabel, units, serving, accent, scoreCall, onPoint }: {
  side: number; name: string; score: string; unitsLabel: string; units: number; serving: boolean; accent: string; scoreCall: string | null; onPoint: (s: number) => void;
}) {
  return (
    <Pressable testID={`score-side-${side}`} onPress={() => onPoint(side)}
      style={({ pressed }) => [styles.panel, { borderColor: serving ? accent : colors.border }, pressed && { backgroundColor: colors.surfaceTertiary }]}>
      <View style={styles.panelTop}>
        <Text style={styles.sideName} numberOfLines={1}>{name}</Text>
        {serving && <View style={[styles.serveDot, { backgroundColor: accent }]} />}
      </View>
      <Text style={[styles.bigScore, { color: serving ? accent : colors.onSurface }]}>{score}</Text>
      <Text style={styles.setsWon}>{unitsLabel} {units}{serving ? " · SERVING" : ""}</Text>
      {scoreCall && <Text style={styles.scoreCall}>{scoreCall}</Text>}
      <Text style={styles.tapHint}>TAP = POINT</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  sport: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, letterSpacing: 2 },
  abandon: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.error },
  syncPill: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncText: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  gamesStrip: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 30, flexWrap: "wrap" },
  gamePill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  gamePillText: { ...font.textBold, fontSize: 12, color: colors.onSurfaceSecondary },
  panels: { flex: 1, flexDirection: "row", gap: spacing.sm, padding: spacing.md },
  panel: { flex: 1, borderWidth: 2, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, padding: spacing.sm, gap: 4 },
  panelTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideName: { ...font.textBold, fontSize: 13, color: colors.onSurface, maxWidth: 140 },
  serveDot: { width: 8, height: 8, borderRadius: 4 },
  bigScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 104, lineHeight: 108 },
  setsWon: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  scoreCall: { ...font.textBold, fontSize: 12, color: colors.onSurfaceTertiary },
  tapHint: { ...font.textBold, letterSpacing: 2, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 4 },
  refZone: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md },
  refCol: { flex: 1, gap: 6 },
  refWho: { ...font.textBold, fontSize: 11, color: colors.onSurfaceSecondary, textAlign: "center" },
  refBtnRow: { flexDirection: "row", gap: 4 },
  refBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 10, alignItems: "center", backgroundColor: colors.surfaceSecondary },
  refBtnText: { ...font.textBold, letterSpacing: 0.5, fontSize: 10, color: colors.onSurfaceSecondary },
  controls: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  ctrlBtn: { flex: 1, flexDirection: "row", gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  undoBtn: { borderColor: colors.warning },
  ctrlText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  refLabel: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  eventLog: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  eventText: { ...font.textBold, fontSize: 12, color: colors.onSurfaceSecondary, letterSpacing: 0.3, paddingVertical: 1 },
});
