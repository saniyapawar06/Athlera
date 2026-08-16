import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";

export type BracketFixture = {
  id: string;
  round: number;
  index: number;
  round_name?: string;
  status: string;
  winner_side: number | null;
  score?: number[] | null;
  scheduled_at?: string | null;
  sides: { side: number; user_ids: string[]; seeds?: (number | null)[] }[];
};

const CARD_H = 72;
const GAP = 20;
const P0 = CARD_H + GAP; // base pitch
const COL_W = 168;
const CONN_W = 30;

function fmtWhen(iso?: string | null) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return null; }
}

export default function KnockoutBracket({
  fixtures, memberName, accent, championIds, isOrganiser, onPressFixture,
}: {
  fixtures: BracketFixture[];
  memberName: (uid: string) => string;
  accent: string;
  championIds?: string[] | null;
  isOrganiser: boolean;
  onPressFixture: (f: BracketFixture) => void;
}) {
  const rounds = useMemo(() => {
    const map = new Map<number, BracketFixture[]>();
    fixtures.forEach((f) => {
      if (!map.has(f.round)) map.set(f.round, []);
      map.get(f.round)!.push(f);
    });
    return Array.from(map.keys()).sort((a, b) => a - b).map((r) => ({
      round: r,
      fixtures: map.get(r)!.sort((a, b) => a.index - b.index),
    }));
  }, [fixtures]);

  const round0Count = rounds[0]?.fixtures.length || 1;
  const contentHeight = round0Count * P0;

  // The "current" round is the earliest round with any unfinished fixture.
  const currentRound = useMemo(() => {
    for (const r of rounds) {
      if (r.fixtures.some((f) => f.status !== "complete" && f.status !== "bye")) return r.round;
    }
    return rounds.length ? rounds[rounds.length - 1].round : 1;
  }, [rounds]);

  const centerFor = (rIdx: number, i: number) => {
    const pitch = P0 * Math.pow(2, rIdx);
    const firstCenter = P0 / 2 + (P0 * (Math.pow(2, rIdx) - 1)) / 2;
    return firstCenter + i * pitch;
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator testID="knockout-bracket" contentContainerStyle={styles.scroll}>
      <View style={{ flexDirection: "row" }}>
        {rounds.map((rd, rIdx) => (
          <React.Fragment key={rd.round}>
            {/* connector column (between previous round and this one) */}
            {rIdx > 0 && (
              <View style={{ width: CONN_W, height: contentHeight }}>
                {rd.fixtures.map((f, i) => {
                  const topPC = centerFor(rIdx - 1, i * 2);
                  const botPC = centerFor(rIdx - 1, i * 2 + 1);
                  const childC = centerFor(rIdx, i);
                  return (
                    <View key={f.id} pointerEvents="none">
                      <View style={[styles.hLine, { top: topPC, left: 0, width: CONN_W / 2 }]} />
                      <View style={[styles.hLine, { top: botPC, left: 0, width: CONN_W / 2 }]} />
                      <View style={[styles.vLine, { top: Math.min(topPC, botPC), left: CONN_W / 2, height: Math.abs(botPC - topPC) }]} />
                      <View style={[styles.hLine, { top: childC, left: CONN_W / 2, width: CONN_W / 2 }]} />
                    </View>
                  );
                })}
              </View>
            )}

            {/* round column */}
            <View style={{ width: COL_W, height: contentHeight }}>
              <View style={styles.roundHeaderWrap} pointerEvents="none">
                <Text style={[styles.roundHeader, rd.round === currentRound && { color: accent }]}>
                  {rd.fixtures[0]?.round_name || `ROUND ${rd.round}`}
                </Text>
              </View>
              {rd.fixtures.map((f, i) => {
                const center = centerFor(rIdx, i);
                const done = f.status === "complete";
                const bye = f.status === "bye";
                const isCurrent = rd.round === currentRound && !done && !bye;
                const clickable = isOrganiser && !done && !bye;
                const when = fmtWhen(f.scheduled_at);
                return (
                  <Pressable
                    key={f.id}
                    testID={`bracket-fixture-${f.id}`}
                    disabled={!clickable}
                    onPress={() => onPressFixture(f)}
                    style={[
                      styles.card,
                      { top: center - CARD_H / 2 },
                      isCurrent && { borderColor: accent },
                    ]}
                  >
                    {[0, 1].map((sideIdx) => {
                      const side = f.sides[sideIdx];
                      const uid = side?.user_ids?.[0];
                      const name = uid ? memberName(uid) : (bye ? "BYE" : "TBD");
                      const seed = side?.seeds?.[0];
                      const isWinner = done && f.winner_side === sideIdx;
                      const isChamp = rIdx === rounds.length - 1 && isWinner;
                      return (
                        <View key={sideIdx} style={[styles.slot, sideIdx === 0 && styles.slotDivider]}>
                          {seed ? <Text style={styles.seed}>{seed}</Text> : <View style={{ width: 16 }} />}
                          <Text
                            style={[styles.name, isWinner && { color: accent, ...font.textBold }, !uid && { color: colors.onSurfaceTertiary }]}
                            numberOfLines={1}
                          >
                            {name}
                          </Text>
                          {isChamp && <Ionicons name="trophy" size={12} color={accent} style={{ marginLeft: 2 }} />}
                          {done && f.score ? <Text style={[styles.score, isWinner && { color: accent }]}>{f.score[sideIdx]}</Text> : null}
                        </View>
                      );
                    })}
                    <View style={styles.statusRow} pointerEvents="none">
                      <Text style={[styles.status, isCurrent && { color: accent }]} numberOfLines={1}>
                        {done ? "COMPLETE" : bye ? "BYE" : when ? when : (clickable ? "TAP TO SCORE" : String(f.status).toUpperCase())}
                      </Text>
                      {clickable && <Ionicons name="create-outline" size={12} color={accent} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </React.Fragment>
        ))}

        {/* champion column */}
        {championIds && championIds.length > 0 && (
          <>
            <View style={{ width: CONN_W, height: contentHeight }}>
              <View style={[styles.hLine, { top: centerFor(rounds.length - 1, 0), left: 0, width: CONN_W }]} pointerEvents="none" />
            </View>
            <View style={{ width: COL_W, height: contentHeight, justifyContent: "center" }}>
              <View style={styles.roundHeaderWrap} pointerEvents="none">
                <Text style={[styles.roundHeader, { color: accent }]}>CHAMPION</Text>
              </View>
              <View style={[styles.champCard, { borderColor: accent, top: centerFor(rounds.length - 1, 0) - CARD_H / 2 }]}>
                <Ionicons name="trophy" size={20} color={accent} />
                <Text style={[styles.champName, { color: accent }]} numberOfLines={2}>{memberName(championIds[0])}</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.xl + 8, paddingHorizontal: spacing.sm },
  roundHeaderWrap: { position: "absolute", top: -26, left: 0, right: 0, alignItems: "center" },
  roundHeader: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurfaceSecondary },
  card: {
    position: "absolute", left: spacing.xs, right: spacing.xs, height: CARD_H,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, overflow: "hidden", justifyContent: "center",
  },
  slot: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, height: 26, gap: 6 },
  slotDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  seed: { ...font.textBold, fontSize: 9, color: colors.onSurfaceTertiary, width: 16, textAlign: "center" },
  name: { ...font.textMedium, fontSize: 12, color: colors.onSurface, flex: 1 },
  score: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 16, color: colors.onSurfaceSecondary, marginLeft: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 18, backgroundColor: colors.surface },
  status: { ...font.textBold, letterSpacing: 0.5, fontSize: 8, color: colors.onSurfaceTertiary },
  hLine: { position: "absolute", height: 2, backgroundColor: colors.borderStrong },
  vLine: { position: "absolute", width: 2, backgroundColor: colors.borderStrong },
  champCard: {
    position: "absolute", left: spacing.xs, right: spacing.xs, height: CARD_H,
    borderWidth: 2, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  champName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 16, textAlign: "center", paddingHorizontal: 4 },
});
