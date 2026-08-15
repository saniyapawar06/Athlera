import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { Confetti } from "@/src/components/ResultOverlay";
import PlayerMultiSelect, { SelectablePlayer } from "@/src/components/PlayerMultiSelect";

type Tab = "fixtures" | "standings" | "players";

const STATUS_LABEL: Record<string, string> = {
  unscheduled: "UNSCHEDULED", scheduled: "SCHEDULED", live: "LIVE", complete: "COMPLETE", bye: "BYE",
};

export default function CompetitionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("fixtures");
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [scoringFixture, setScoringFixture] = useState<any | null>(null);
  const [g, setG] = useState<{ a: string; b: string }[]>([{ a: "", b: "" }]);
  const [err, setErr] = useState<string | null>(null);
  // sheets
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);
  const [newPlayers, setNewPlayers] = useState<SelectablePlayer[]>([]);
  const [scheduleFixture, setScheduleFixture] = useState<any | null>(null);
  const [schedDate, setSchedDate] = useState(""); const [schedTime, setSchedTime] = useState("");
  const [addFixtureOpen, setAddFixtureOpen] = useState(false);
  const [pickA, setPickA] = useState<string | null>(null); const [pickB, setPickB] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  const manualLeague = !isKO && c.fixture_mode === "manual";
  const playerMembers = (c.members || []).filter((m: any) => m.role !== "organiser_only");

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

  const saveSchedule = async () => {
    let iso: string | null = null;
    if (schedDate.trim()) {
      const dt = `${schedDate.trim()}T${(schedTime.trim() || "12:00")}:00`;
      const parsed = new Date(dt);
      if (isNaN(parsed.getTime())) { setErr("Use date YYYY-MM-DD and time HH:MM"); return; }
      iso = parsed.toISOString();
    }
    await act(() => api.fixtureUpdate(scheduleFixture.id, { scheduled_at: iso }));
    setScheduleFixture(null); setSchedDate(""); setSchedTime("");
  };

  const addFixture = async () => {
    if (!pickA || !pickB || pickA === pickB) { setErr("Pick two different players"); return; }
    await act(() => api.compAddFixture(cid, { side0_user_ids: [pickA], side1_user_ids: [pickB] }));
    setAddFixtureOpen(false); setPickA(null); setPickB(null);
  };

  const rounds = Array.from(new Set(data.fixtures.map((f: any) => f.round))).sort((a: any, b: any) => a - b);
  const hasFixtures = data.fixtures.length > 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="competition-detail-screen">
      {champion && <Confetti />}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="cd-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: accent }]} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.sub}>{c.type.toUpperCase()} · {c.member_count} players · {String(c.status).replace(/_/g, " ")}{manualLeague ? " · MANUAL" : ""}</Text>
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
          <Pressable testID="add-players-btn" onPress={() => { setNewPlayers([]); setAddPlayersOpen(true); }} style={[styles.orgBtnOutline]}>
            <Ionicons name="person-add" size={14} color={colors.onSurface} />
            <Text style={styles.orgBtnOutlineText}>ADD PLAYERS</Text>
          </Pressable>
          {!hasFixtures && !manualLeague ? (
            <Pressable testID="generate-fixtures-btn" onPress={() => act(() => api.compGenerate(cid))} disabled={busy} style={[styles.orgBtn, { backgroundColor: accent }]}>
              <Text style={styles.orgBtnText}>{busy ? "…" : "GENERATE"}</Text>
            </Pressable>
          ) : (
            <Pressable testID="manage-fixtures-btn" onPress={() => setManage((m) => !m)} style={[styles.orgBtnOutline, manage && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
              <Ionicons name="construct" size={14} color={manage ? accent : colors.onSurface} />
              <Text style={[styles.orgBtnOutlineText, manage && { color: accent }]}>MANAGE</Text>
            </Pressable>
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
          <>
            {manage && manualLeague && (
              <Pressable testID="add-fixture-btn" onPress={() => { setPickA(null); setPickB(null); setAddFixtureOpen(true); }} style={[styles.addFixture, { borderColor: accent }]}>
                <Ionicons name="add" size={18} color={accent} />
                <Text style={[styles.addFixtureText, { color: accent }]}>ADD FIXTURE</Text>
              </Pressable>
            )}
            {!hasFixtures ? <Text style={styles.hint}>No fixtures yet.{c.is_organiser ? (manualLeague ? " Tap Manage → Add Fixture." : " Generate them above.") : ""}</Text> :
              (isKO && !manage) ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bracket} testID="knockout-bracket">
                  {rounds.map((r: any, ri: number) => {
                    const roundFixtures = data.fixtures.filter((f: any) => f.round === r).sort((a: any, b: any) => a.index - b.index);
                    const isFinal = ri === rounds.length - 1;
                    return (
                      <View key={r} style={styles.brColumn}>
                        <Text style={styles.brRoundLabel}>{isFinal ? "FINAL" : rounds.length - ri === 2 ? "SEMI-FINAL" : `ROUND ${r}`}</Text>
                        <View style={styles.brColInner}>
                          {roundFixtures.map((f: any) => {
                            const done = f.status === "complete";
                            const bye = f.status === "bye";
                            const editable = c.is_organiser && !done && !bye && f.sides[0].user_ids.length && f.sides[1].user_ids.length;
                            const score = (f.score || []);
                            return (
                              <Pressable
                                key={f.id}
                                testID={`bracket-fixture-${f.id}`}
                                disabled={!editable}
                                onPress={() => { setScoringFixture(f); setG([{ a: "", b: "" }]); }}
                                style={[styles.brMatch, isFinal && { borderColor: accent }]}
                              >
                                {[0, 1].map((si) => {
                                  const uids = f.sides[si].user_ids;
                                  const nm = uids.length ? memberName(c, uids[0]) : (bye ? "BYE" : "TBD");
                                  const won = done && f.winner_side === si;
                                  return (
                                    <View key={si} style={[styles.brSlot, si === 0 && styles.brSlotDivider]}>
                                      <Text style={[styles.brName, won && { color: accent }]} numberOfLines={1}>{nm}</Text>
                                      <Text style={[styles.brScore, won && { color: accent }]}>{done && score[si] != null ? score[si] : ""}</Text>
                                    </View>
                                  );
                                })}
                                <Text style={styles.brStatus}>
                                  {done ? "COMPLETE" : bye ? "BYE" : f.scheduled_at ? fmtWhen(f.scheduled_at) : editable ? "TAP TO SCORE" : "AWAITING PLAYERS"}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              ) :
              rounds.map((r: any) => {
                const roundFixtures = data.fixtures.filter((f: any) => f.round === r);
                return (
                  <View key={r} style={{ gap: spacing.sm }}>
                    <Text style={styles.roundLabel}>{isKO ? `ROUND ${r}` : "FIXTURES"}</Text>
                    {roundFixtures.map((f: any, fi: number) => {
                      const n0 = f.sides[0].user_ids.length ? memberName(c, f.sides[0].user_ids[0]) : "—";
                      const n1 = f.sides[1].user_ids.length ? memberName(c, f.sides[1].user_ids[0]) : "—";
                      const done = f.status === "complete";
                      const bye = f.status === "bye";
                      const editable = c.is_organiser && !done && !bye;
                      return (
                        <View key={f.id} style={styles.fixture} testID={`fixture-${f.id}`}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.fName, done && f.winner_side === 0 && { color: accent }]}>{n0}</Text>
                            <Text style={[styles.fName, done && f.winner_side === 1 && { color: accent }]}>{n1}</Text>
                            <Text style={styles.fStatus} testID={`fixture-status-${f.id}`}>
                              {STATUS_LABEL[f.status] || String(f.status).toUpperCase()}
                              {f.scheduled_at ? ` · ${fmtWhen(f.scheduled_at)}` : ""}
                            </Text>
                          </View>

                          {manage && editable ? (
                            <View style={styles.manageCol}>
                              <Pressable testID={`fx-schedule-${f.id}`} onPress={() => { setScheduleFixture(f); const d = f.scheduled_at ? new Date(f.scheduled_at) : null; setSchedDate(d ? d.toISOString().slice(0, 10) : ""); setSchedTime(d ? d.toISOString().slice(11, 16) : ""); }} style={styles.mBtn}><Ionicons name="calendar" size={16} color={colors.onSurface} /></Pressable>
                              <Pressable testID={`fx-up-${f.id}`} onPress={() => act(() => api.fixtureUpdate(f.id, { position: Math.max(0, f.index - 1) }))} style={styles.mBtn}><Ionicons name="arrow-up" size={16} color={colors.onSurface} /></Pressable>
                              <Pressable testID={`fx-down-${f.id}`} onPress={() => act(() => api.fixtureUpdate(f.id, { position: f.index + 1 }))} style={styles.mBtn}><Ionicons name="arrow-down" size={16} color={colors.onSurface} /></Pressable>
                              <Pressable testID={`fx-remove-${f.id}`} onPress={() => act(() => api.fixtureRemove(f.id))} style={styles.mBtn}><Ionicons name="trash" size={15} color={colors.error} /></Pressable>
                            </View>
                          ) : done ? <Text style={styles.fScore}>{(f.score || []).join("-")}</Text> :
                            bye ? <Text style={styles.fBye}>BYE</Text> :
                            c.is_organiser ? (
                              <View style={{ gap: 4 }}>
                                <Pressable testID={`score-live-${f.id}`} onPress={() => router.push(`/live/setup?sport_id=${c.sport_id}&competition_id=${c.id}&fixture_id=${f.id}`)} style={styles.fLive}><Text style={styles.fLiveText}>LIVE</Text></Pressable>
                                <Pressable testID={`score-manual-${f.id}`} onPress={() => { setScoringFixture(f); setG([{ a: "", b: "" }]); }} style={styles.fManual}><Text style={styles.fManualText}>ENTER</Text></Pressable>
                              </View>
                            ) : <Text style={styles.fSched}>{STATUS_LABEL[f.status] || ""}</Text>}
                        </View>
                      );
                    })}
                  </View>
                );
              })}
          </>
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
              <View key={m.user_id} style={styles.playerRow} testID={`player-${m.user_id}`}>
                <Pressable style={{ flex: 1 }} onPress={() => router.push(`/athlete/${m.user_id}`)}>
                  <Text style={styles.playerName}>{m.display_name}</Text>
                </Pressable>
                <Text style={styles.playerRole}>{String(m.role).toUpperCase()}</Text>
                {c.is_organiser && m.role !== "organiser" && !hasFixtures && (
                  <Pressable testID={`remove-player-${m.user_id}`} onPress={() => act(() => api.compRemoveMember(cid, m.user_id))} hitSlop={8} style={{ paddingLeft: spacing.sm }}>
                    <Ionicons name="close-circle" size={20} color={colors.onSurfaceTertiary} />
                  </Pressable>
                )}
              </View>
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
          {err && <Text style={styles.err} testID="mg-error">{err}</Text>}
          <Pressable testID="mg-submit" onPress={submitFixture} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}>
            <Text style={styles.ctaText}>SAVE RESULT</Text>
          </Pressable>
        </View>
      )}

      {/* schedule sheet */}
      {scheduleFixture && (
        <View style={styles.sheet} testID="schedule-sheet">
          <Text style={styles.sheetTitle}>SCHEDULE FIXTURE</Text>
          <Text style={styles.sheetSub}>{memberName(c, scheduleFixture.sides[0].user_ids[0])} vs {memberName(c, scheduleFixture.sides[1].user_ids[0])}</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1.4, gap: 6 }}><Text style={styles.label}>DATE (YYYY-MM-DD)</Text><TextInput testID="sched-date" value={schedDate} onChangeText={setSchedDate} placeholder="2026-07-01" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
            <View style={{ flex: 1, gap: 6 }}><Text style={styles.label}>TIME (HH:MM)</Text><TextInput testID="sched-time" value={schedTime} onChangeText={setSchedTime} placeholder="18:30" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="sched-clear" onPress={() => { setSchedDate(""); setSchedTime(""); }} style={styles.ghost}><Text style={styles.ghostText}>UNSCHEDULE</Text></Pressable>
            <Pressable testID="sched-cancel" onPress={() => setScheduleFixture(null)} style={styles.ghost}><Text style={styles.ghostText}>CANCEL</Text></Pressable>
          </View>
          {err && <Text style={styles.err} testID="sched-error">{err}</Text>}
          <Pressable testID="sched-save" onPress={saveSchedule} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}><Text style={styles.ctaText}>SAVE</Text></Pressable>
        </View>
      )}

      {/* add players sheet */}
      {addPlayersOpen && (
        <View style={styles.sheetTall} testID="add-players-sheet">
          <Text style={styles.sheetTitle}>ADD PLAYERS</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
            <PlayerMultiSelect sportId={c.sport_id} accent={accent} selected={newPlayers} onChange={setNewPlayers} excludeUserIds={playerMembers.map((m: any) => m.user_id).concat([c.organiser_id])} />
          </ScrollView>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="ap-cancel" onPress={() => setAddPlayersOpen(false)} style={styles.ghost}><Text style={styles.ghostText}>CANCEL</Text></Pressable>
            <Pressable testID="ap-save" onPress={async () => { const ps = newPlayers; setAddPlayersOpen(false); await act(async () => { for (const p of ps) { try { await api.compAddMember(cid, p.user_id); } catch {} } }); }} disabled={busy} style={[styles.cta, { flex: 1, backgroundColor: accent }]}><Text style={styles.ctaText}>ADD {newPlayers.length > 0 ? newPlayers.length : ""}</Text></Pressable>
          </View>
        </View>
      )}

      {/* add fixture sheet (manual league) */}
      {addFixtureOpen && (
        <View style={styles.sheetTall} testID="add-fixture-sheet">
          <Text style={styles.sheetTitle}>ADD FIXTURE</Text>
          <Text style={styles.sheetSub}>Pick the two players for this match.</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            <Text style={styles.label}>PLAYER A</Text>
            {playerMembers.map((m: any) => (
              <Pressable key={`a-${m.user_id}`} testID={`af-a-${m.user_id}`} onPress={() => setPickA(m.user_id)} style={[styles.pickRow, pickA === m.user_id && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name={pickA === m.user_id ? "radio-button-on" : "radio-button-off"} size={18} color={accent} />
                <Text style={styles.pickName}>{m.display_name}</Text>
              </Pressable>
            ))}
            <Text style={[styles.label, { marginTop: spacing.sm }]}>PLAYER B</Text>
            {playerMembers.filter((m: any) => m.user_id !== pickA).map((m: any) => (
              <Pressable key={`b-${m.user_id}`} testID={`af-b-${m.user_id}`} onPress={() => setPickB(m.user_id)} style={[styles.pickRow, pickB === m.user_id && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name={pickB === m.user_id ? "radio-button-on" : "radio-button-off"} size={18} color={accent} />
                <Text style={styles.pickName}>{m.display_name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {err && <Text style={styles.err} testID="af-error">{err}</Text>}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable testID="af-cancel" onPress={() => setAddFixtureOpen(false)} style={styles.ghost}><Text style={styles.ghostText}>CANCEL</Text></Pressable>
            <Pressable testID="af-save" onPress={addFixture} disabled={busy} style={[styles.cta, { flex: 1, backgroundColor: accent }]}><Text style={styles.ctaText}>ADD FIXTURE</Text></Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function memberName(c: any, uid: string) {
  const m = (c.members || []).find((x: any) => x.user_id === uid);
  return m ? m.display_name : "Athlete";
}
function fmtWhen(iso: string) {
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, letterSpacing: 1 },
  sub: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary },
  champBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  champText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface, letterSpacing: 1 },
  orgBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexWrap: "wrap" },
  orgLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  orgBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  orgBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 12, color: "#0B0D12" },
  orgBtnOutline: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  orgBtnOutlineText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurface },
  tabs: { flexDirection: "row", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceTertiary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13 },
  roundLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  addFixture: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md, borderWidth: 1, borderRadius: radius.md, borderStyle: "dashed", backgroundColor: colors.surfaceSecondary },
  addFixtureText: { ...font.textBold, letterSpacing: 1, fontSize: 12 },
  fixture: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  fName: { ...font.textBold, fontSize: 14, color: colors.onSurface, marginVertical: 1 },
  fStatus: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary, marginTop: 3 },
  fScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface },
  fBye: { ...font.textBold, fontSize: 11, color: colors.onSurfaceTertiary, letterSpacing: 1 },
  fSched: { ...font.textBold, fontSize: 10, color: colors.onSurfaceTertiary, letterSpacing: 1 },
  fLive: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  fLiveText: { ...font.textBold, fontSize: 10, color: colors.brand, letterSpacing: 1 },
  fManual: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  fManualText: { ...font.textBold, fontSize: 10, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  manageCol: { flexDirection: "row", gap: 4, alignItems: "center" },
  mBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stHeadRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  stHead: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary, width: 36, textAlign: "center" },
  stRow: { flexDirection: "row", alignItems: "center", padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  stCell: { ...font.textMedium, fontSize: 13, color: colors.onSurface, width: 36, textAlign: "center" },
  stPts: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 18 },
  playerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  playerName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  playerRole: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTall: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  sheetSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  label: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, ...font.text, fontSize: 15 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: 6 },
  pickName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  gRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  gInput: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, textAlign: "center", paddingVertical: spacing.sm, borderRadius: radius.md, ...font.display, fontFamily: "BarlowCondensed", fontSize: 24 },
  gDash: { ...font.textBold, color: colors.onSurfaceTertiary },
  ghost: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  ghostText: { ...font.textBold, fontSize: 11, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
