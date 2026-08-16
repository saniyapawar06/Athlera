import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Modal, Dimensions } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { cacheGet, cacheSet } from "@/src/utils/cache";
import PressableScale from "@/src/components/PressableScale";
import * as Location from "expo-location";

type Tab = "feed" | "nearby" | "ltp" | "requests";

const FEED_META: Record<string, { icon: any; label: string; color: string }> = {
  match_result: { icon: "tennisball", label: "MATCH RESULT", color: colors.brand },
  competition_win: { icon: "trophy", label: "CHAMPION", color: "#FFD54A" },
  personal_best: { icon: "star", label: "PERSONAL BEST", color: "#FFC107" },
  looking_to_play: { icon: "megaphone", label: "LOOKING TO PLAY", color: "#4C8DFF" },
  streak: { icon: "flame", label: "ON A STREAK", color: "#FF6B4A" },
  achievement: { icon: "medal", label: "ACHIEVEMENT", color: "#00FA9A" },
};

export default function SocialScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feed");
  const [feed, setFeed] = useState<any[]>(() => cacheGet("feed") ?? []);
  const [nearby, setNearby] = useState<any[]>(() => cacheGet("nearby") ?? []);
  const [ltp, setLtp] = useState<any[]>(() => cacheGet("ltp") ?? []);
  const [reqs, setReqs] = useState<{ incoming: any[]; outgoing: any[] }>(() => cacheGet("reqs") ?? { incoming: [], outgoing: [] });
  const [myOrgComps, setMyOrgComps] = useState<any[]>(() => cacheGet("orgComps") ?? []);
  const [loading, setLoading] = useState(() => !cacheGet("feed"));
  const [busy, setBusy] = useState(false);
  const [locationState, setLocationState] = useState<"checking" | "granted" | "manual">("checking");
  const [city, setCity] = useState("");
  const [nearbyView, setNearbyView] = useState<"list" | "map">("list");
  const [commentOn, setCommentOn] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [inviteFor, setInviteFor] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, n, l, r, mc] = await Promise.all([
        api.feed(), api.nearby({ city: city || undefined }), api.ltpList(), api.playRequestsMine(), api.compMine(),
      ]);
      const feedItems = f.items || [];
      const nearbyPlayers = n.players || [];
      const ltpPosts = l.posts || [];
      const orgComps = (mc.competitions || []).filter((c: any) => c.is_organiser || c.my_role === "organiser");
      setFeed(feedItems); setNearby(nearbyPlayers); setLtp(ltpPosts); setReqs(r); setMyOrgComps(orgComps);
      cacheSet("feed", feedItems); cacheSet("nearby", nearbyPlayers); cacheSet("ltp", ltpPosts); cacheSet("reqs", r); cacheSet("orgComps", orgComps);
    } finally { setLoading(false); }
  }, [city]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      setLocationState(permission.status === "granted" ? "granted" : "manual");
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(); }, 500);
    return () => clearTimeout(t);
  }, [city]);

  const toggleLike = async (item: any) => {
    setFeed((prev) => prev.map((it) => it.id === item.id ? { ...it, liked_by_me: !it.liked_by_me, like_count: it.like_count + (it.liked_by_me ? -1 : 1) } : it));
    try { await api.feedLike(item.id); } catch { load(); }
  };

  const openComments = async (item: any) => {
    if (commentOn === item.id) { setCommentOn(null); return; }
    setCommentOn(item.id); setComments([]); setCommentText("");
    try { const r = await api.feedComments(item.id); setComments(r.comments || []); } catch {}
  };

  const sendComment = async () => {
    if (!commentText.trim() || !commentOn) return;
    try {
      await api.feedComment(commentOn, commentText.trim());
      setCommentText("");
      const r = await api.feedComments(commentOn);
      setComments(r.comments || []);
      setFeed((prev) => prev.map((it) => it.id === commentOn ? { ...it, comment_count: (it.comment_count || 0) + 1 } : it));
    } catch {}
  };

  const askToPlay = async (uid: string, sport_id: string) => {
    setBusy(true);
    try { await api.playRequestCreate({ to_user_id: uid, sport_id }); await load(); setTab("requests"); }
    catch (e) { /* duplicate etc */ } finally { setBusy(false); }
  };

  const reqAction = async (rid: string, action: string) => {
    setBusy(true);
    try { await api.playRequestAction(rid, action); await load(); } finally { setBusy(false); }
  };

  const invite = async (cid: string) => {
    if (!inviteFor) return;
    setBusy(true);
    try { await api.compAddMember(cid, inviteFor.user_id); setInviteFor(null); }
    catch (e) { /* already member */ setInviteFor(null); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="social-screen">
      <View style={styles.header}>
        <Text style={styles.title}>SOCIAL</Text>
        <Pressable testID="new-ltp-btn" onPress={() => router.push("/looking-to-play/create")} style={styles.newBtn}>
          <Ionicons name="add" size={18} color={colors.onBrand} /><Text style={styles.newBtnText}>LOOKING TO PLAY</Text>
        </Pressable>
      </View>
      <View style={styles.tabs}>
        {(["feed", "ltp", "nearby", "requests"] as Tab[]).map((t) => (
          <Pressable key={t} testID={`social-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: colors.brand }]}>
            <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]} numberOfLines={1}>
              {t === "feed" ? "Feed" : t === "ltp" ? "Looking to Play" : t === "nearby" ? "Nearby Players" : "Requests"}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "nearby" && (
        <View style={styles.nearbyBar}>
          <View style={styles.viewToggle}>
            {(["list", "map"] as const).map((v) => (
              <Pressable key={v} testID={`nearby-view-${v}`} onPress={() => setNearbyView(v)} style={[styles.viewBtn, nearbyView === v && { backgroundColor: colors.surfaceTertiary, borderColor: colors.brand }]}>
                <Ionicons name={v === "list" ? "list" : "navigate"} size={14} color={nearbyView === v ? colors.onSurface : colors.onSurfaceTertiary} />
                <Text style={[styles.viewText, nearbyView === v && { color: colors.onSurface }]}>{v.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput testID="nearby-city-input" value={city} onChangeText={setCity} placeholder={locationState === "granted" ? "Filter by city (optional)" : "Type your city"} placeholderTextColor={colors.onSurfaceTertiary} style={styles.cityInput} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
        tab === "feed" ? (
          feed.length === 0 ? <Empty t="No activity yet — play a match to kick things off" cta="Score a match" onPress={() => router.push("/(tabs)/score")} /> :
          feed.map((it, i) => {
            const meta = FEED_META[it.type] || FEED_META.match_result;
            const isLTP = it.type === "looking_to_play";
            return (
              <Animated.View key={it.id} entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(300)} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: sportAccent(it.sport_id) }]} testID={`feed-${it.id}`}>
                <View style={styles.feedHead}>
                  <View style={[styles.typeChip, { borderColor: meta.color }]}>
                    <Ionicons name={meta.icon} size={12} color={meta.color} />
                    <Text style={[styles.typeChipText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {it.rating_delta != null && <Text style={[styles.feedDelta, { color: it.rating_delta >= 0 ? colors.success : colors.error }]}>{it.rating_delta >= 0 ? "+" : ""}{it.rating_delta}</Text>}
                </View>
                <Pressable testID={`feed-open-${it.id}`} onPress={() => it.match_id ? router.push(`/match/${it.match_id}`) : (it.actor_id ? router.push(`/athlete/${it.actor_id}`) : null)}>
                  <Text style={styles.feedText}>{it.text}</Text>
                  {it.score ? <Text style={styles.feedScore}>{it.score}</Text> : null}
                </Pressable>
                <View style={styles.feedActions}>
                  <PressableScale testID={`feed-like-${it.id}`} haptic onPress={() => toggleLike(it)} style={styles.feedBtn}>
                    <Ionicons name={it.liked_by_me ? "heart" : "heart-outline"} size={18} color={it.liked_by_me ? colors.brand : colors.onSurfaceSecondary} />
                    <Text style={styles.feedBtnText}>{it.like_count || 0}</Text>
                  </PressableScale>
                  <Pressable testID={`feed-comment-${it.id}`} onPress={() => openComments(it)} style={styles.feedBtn}>
                    <Ionicons name="chatbubble-outline" size={16} color={colors.onSurfaceSecondary} />
                    <Text style={styles.feedBtnText}>{it.comment_count || 0}</Text>
                  </Pressable>
                  {it.match_id && (
                    <Pressable testID={`feed-share-${it.id}`} onPress={() => router.push(`/match/${it.match_id}`)} style={styles.feedBtn}>
                      <Ionicons name="open-outline" size={16} color={colors.onSurfaceSecondary} />
                      <Text style={styles.feedBtnText}>DETAILS</Text>
                    </Pressable>
                  )}
                  {isLTP && it.actor_id && (
                    <Pressable testID={`feed-respond-${it.id}`} onPress={() => askToPlay(it.actor_id, it.sport_id)} style={styles.feedBtn}>
                      <Ionicons name="hand-right-outline" size={16} color={colors.brand} />
                      <Text style={[styles.feedBtnText, { color: colors.brand }]}>RESPOND</Text>
                    </Pressable>
                  )}
                </View>
                {commentOn === it.id && (
                  <View style={styles.commentBox} testID={`feed-comments-${it.id}`}>
                    {comments.map((cm) => (<Text key={cm.id} style={styles.commentLine}><Text style={styles.commentName}>{cm.name}: </Text>{cm.text}</Text>))}
                    <View style={styles.commentInputRow}>
                      <TextInput testID={`comment-input-${it.id}`} value={commentText} onChangeText={setCommentText} placeholder="Add a comment…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.commentInput} />
                      <Pressable testID={`comment-send-${it.id}`} onPress={sendComment} style={styles.commentSend}><Text style={styles.commentSendText}>POST</Text></Pressable>
                    </View>
                  </View>
                )}
              </Animated.View>
            );
          })
        ) :
        tab === "nearby" ? (
          nearby.length === 0 ? <Empty t="No players nearby yet — set your city above to discover players" /> :
          nearbyView === "map" ? (
            <RadarMap players={nearby} onSelect={(p) => router.push(`/athlete/${p.user_id}`)} />
          ) :
          nearby.map((p) => (
            <View key={p.user_id + p.sport_id} style={styles.card} testID={`nearby-${p.user_id}`}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.name}>{p.display_name}</Text>
                  {p.same_city && <View style={styles.nearTag}><Text style={styles.nearTagText}>NEAR YOU</Text></View>}
                </View>
                <Text style={styles.meta}>{p.area} · ~{p.distance_km} km · <Text style={{ color: sportAccent(p.sport_id) }}>{p.sport.name}</Text> {p.rating}</Text>
                <View style={styles.actionRow}>
                  <Pressable testID={`view-${p.user_id}`} onPress={() => router.push(`/athlete/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>PROFILE</Text></Pressable>
                  <Pressable testID={`ask-${p.user_id}`} onPress={() => askToPlay(p.user_id, p.sport_id)} disabled={busy} style={[styles.miniBtn, { borderColor: colors.brand }]}><Text style={[styles.miniText, { color: colors.brand }]}>ASK TO PLAY</Text></Pressable>
                  <Pressable testID={`msg-${p.user_id}`} onPress={() => router.push(`/messages/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>MESSAGE</Text></Pressable>
                  {myOrgComps.length > 0 && <Pressable testID={`invite-${p.user_id}`} onPress={() => setInviteFor(p)} style={styles.miniBtn}><Text style={styles.miniText}>INVITE</Text></Pressable>}
                </View>
              </View>
            </View>
          ))
        ) : tab === "ltp" ? (
          ltp.length === 0 ? <Empty t="No open posts — create one so players can respond" cta="Looking to play" onPress={() => router.push("/looking-to-play/create")} /> :
          ltp.map((p) => (
            <View key={p.id} style={styles.card} testID={`ltp-${p.id}`}>
              <View style={styles.ltpHead}>
                <View style={[styles.sportDot, { backgroundColor: sportAccent(p.sport_id) }]} />
                <Text style={styles.ltpSport}>{p.sport.name.toUpperCase()}</Text>
                <Text style={styles.ltpBy}>· {p.display_name}{p.is_mine ? " (You)" : ""}</Text>
              </View>
              <Text style={styles.ltpWhen}>{p.when_text} · {p.area} · within {p.radius_km}km</Text>
              {p.message ? <Text style={styles.ltpMsg}>“{p.message}”</Text> : null}
              {!p.is_mine && (
                <View style={styles.actionRow}>
                  <Pressable testID={`ltp-profile-${p.id}`} onPress={() => router.push(`/athlete/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>PROFILE</Text></Pressable>
                  <Pressable testID={`ltp-ask-${p.id}`} onPress={() => askToPlay(p.user_id, p.sport_id)} style={[styles.miniBtn, { borderColor: colors.brand }]}><Text style={[styles.miniText, { color: colors.brand }]}>RESPOND</Text></Pressable>
                  <Pressable testID={`ltp-msg-${p.id}`} onPress={() => router.push(`/messages/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>MESSAGE</Text></Pressable>
                </View>
              )}
            </View>
          ))
        ) : (
          <View style={{ gap: spacing.md }}>
            <Text style={styles.groupLabel}>INCOMING</Text>
            {reqs.incoming.length === 0 ? <Empty t="No incoming requests" /> :
              reqs.incoming.map((r) => (
                <View key={r.id} style={styles.card} testID={`req-in-${r.id}`}>
                  <Text style={styles.name}>{r.other_name} · <Text style={{ color: sportAccent(r.sport_id) }}>{r.sport_id}</Text></Text>
                  <Text style={styles.meta}>{r.status.toUpperCase()}{r.message ? ` · “${r.message}”` : ""}</Text>
                  {r.status === "accepted" && <Pressable testID={`req-score-${r.id}`} onPress={() => router.push("/(tabs)/score")} style={[styles.miniBtn, { alignSelf: "flex-start", marginTop: 6, borderColor: colors.brand }]}><Text style={[styles.miniText, { color: colors.brand }]}>SCORE MATCH →</Text></Pressable>}
                  {r.status === "pending" && (
                    <View style={styles.actionRow}>
                      <Pressable testID={`accept-${r.id}`} onPress={() => reqAction(r.id, "accept")} style={[styles.miniBtn, { borderColor: colors.success }]}><Text style={[styles.miniText, { color: colors.success }]}>ACCEPT</Text></Pressable>
                      <Pressable testID={`decline-${r.id}`} onPress={() => reqAction(r.id, "decline")} style={[styles.miniBtn, { borderColor: colors.error }]}><Text style={[styles.miniText, { color: colors.error }]}>DECLINE</Text></Pressable>
                      <Pressable testID={`req-msg-${r.id}`} onPress={() => router.push(`/messages/${r.from_user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>MESSAGE</Text></Pressable>
                    </View>
                  )}
                </View>
              ))}
            <Text style={styles.groupLabel}>OUTGOING</Text>
            {reqs.outgoing.length === 0 ? <Empty t="No outgoing requests" /> :
              reqs.outgoing.map((r) => (
                <View key={r.id} style={styles.card} testID={`req-out-${r.id}`}>
                  <Text style={styles.name}>{r.other_name} · <Text style={{ color: sportAccent(r.sport_id) }}>{r.sport_id}</Text></Text>
                  <Text style={styles.meta}>{r.status.toUpperCase()}</Text>
                  {r.status === "accepted" && <Pressable testID={`req-out-score-${r.id}`} onPress={() => router.push("/(tabs)/score")} style={[styles.miniBtn, { alignSelf: "flex-start", marginTop: 6, borderColor: colors.brand }]}><Text style={[styles.miniText, { color: colors.brand }]}>SCORE MATCH →</Text></Pressable>}
                  {r.status === "pending" && <Pressable testID={`cancel-${r.id}`} onPress={() => reqAction(r.id, "cancel")} style={[styles.miniBtn, { alignSelf: "flex-start", marginTop: 6 }]}><Text style={styles.miniText}>CANCEL</Text></Pressable>}
                </View>
              ))}
          </View>
        )}
      </ScrollView>

      {/* Invite to competition sheet */}
      <Modal visible={!!inviteFor} transparent animationType="slide" onRequestClose={() => setInviteFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setInviteFor(null)} />
        <View style={styles.sheet} testID="invite-sheet">
          <Text style={styles.sheetTitle}>INVITE {inviteFor?.display_name?.toUpperCase()}</Text>
          <Text style={styles.sheetSub}>Add this player to a competition you organise.</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {myOrgComps.length === 0 ? <Text style={styles.meta}>You don't organise any competitions yet.</Text> :
              myOrgComps.map((c) => (
                <Pressable key={c.id} testID={`invite-comp-${c.id}`} onPress={() => invite(c.id)} disabled={busy} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.name}</Text>
                    <Text style={styles.meta}>{c.type?.toUpperCase()} · {c.member_count} players</Text>
                  </View>
                  <Ionicons name="add-circle" size={22} color={sportAccent(c.sport_id)} />
                </Pressable>
              ))}
          </ScrollView>
          <Pressable testID="invite-close" onPress={() => setInviteFor(null)} style={styles.ghost}><Text style={styles.ghostText}>CLOSE</Text></Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RadarMap({ players, onSelect }: { players: any[]; onSelect: (p: any) => void }) {
  const W = Math.min(Dimensions.get("window").width - spacing.md * 2, 360);
  const size = W;
  const cx = size / 2, cy = size / 2;
  const maxKm = Math.max(10, ...players.map((p) => p.distance_km));
  const rings = [0.33, 0.66, 1];
  return (
    <View testID="nearby-radar" style={{ alignItems: "center", gap: spacing.md }}>
      <View style={[styles.radar, { width: size, height: size, borderRadius: size / 2 }]}>
        {rings.map((r, i) => (
          <View key={i} style={[styles.ring, { width: size * r, height: size * r, borderRadius: (size * r) / 2, left: cx - (size * r) / 2, top: cy - (size * r) / 2 }]} />
        ))}
        <View style={[styles.centerDot, { left: cx - 6, top: cy - 6 }]} />
        <Text style={[styles.youLabel, { left: cx + 8, top: cy - 4 }]}>YOU</Text>
        {players.slice(0, 24).map((p) => {
          const rr = (Math.min(p.distance_km, maxKm) / maxKm) * (size / 2 - 22) + 14;
          const rad = (p.angle || 0) * Math.PI / 180;
          const x = cx + rr * Math.cos(rad) - 5;
          const y = cy + rr * Math.sin(rad) - 5;
          return (
            <Pressable key={p.user_id + p.sport_id} testID={`radar-dot-${p.user_id}`} onPress={() => onSelect(p)} style={{ position: "absolute", left: x - 4, top: y - 4 }} hitSlop={10}>
              <View style={[styles.radarDot, { backgroundColor: sportAccent(p.sport_id) }]} />
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.radarNote}>Approximate proximity only — exact locations are never shared. Tap a dot to view a profile.</Text>
    </View>
  );
}

function Empty({ t, cta, onPress }: { t: string; cta?: string; onPress?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{t}</Text>
      {cta && onPress && <Pressable testID="empty-cta" onPress={onPress} style={styles.emptyCta}><Text style={styles.emptyCtaText}>{cta} →</Text></Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  feedHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, flex: 0 },
  typeChipText: { ...font.textBold, letterSpacing: 1, fontSize: 9 },
  sportDot: { width: 8, height: 8, borderRadius: 4 },
  feedDelta: { ...font.textBold, fontSize: 13, marginLeft: "auto" },
  feedText: { ...font.textMedium, fontSize: 15, color: colors.onSurface, marginTop: 8 },
  feedScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurfaceSecondary, letterSpacing: 1, marginTop: 2 },
  feedActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  feedBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  feedBtnText: { ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurfaceSecondary },
  commentBox: { marginTop: spacing.sm, gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  commentLine: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary },
  commentName: { ...font.textBold, color: colors.onSurface },
  commentInputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginTop: 4 },
  commentInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, ...font.text, fontSize: 13, backgroundColor: colors.surface },
  commentSend: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  commentSendText: { ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onBrand },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  newBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onBrand },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 0.5, fontSize: 10, color: colors.onSurfaceTertiary },
  nearbyBar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  viewToggle: { flexDirection: "row", gap: spacing.sm },
  viewBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.surfaceSecondary },
  viewText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary },
  cityInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, ...font.text, fontSize: 14, backgroundColor: colors.surfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 6 },
  name: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  meta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  nearTag: { borderWidth: 1, borderColor: colors.success, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  nearTagText: { ...font.textBold, letterSpacing: 1, fontSize: 8, color: colors.success },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: 8, flexWrap: "wrap" },
  miniBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  ltpHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  ltpSport: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurface },
  ltpBy: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  ltpWhen: { ...font.textMedium, fontSize: 13, color: colors.onSurface },
  ltpMsg: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  groupLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  empty: { padding: spacing.lg, alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderStyle: "dashed" },
  emptyText: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary, textAlign: "center" },
  emptyCta: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  emptyCtaText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.brand },
  radar: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm, overflow: "hidden" },
  ring: { position: "absolute", borderWidth: 1, borderColor: colors.borderStrong },
  centerDot: { position: "absolute", width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand },
  youLabel: { position: "absolute", ...font.textBold, fontSize: 9, letterSpacing: 1, color: colors.onSurfaceSecondary },
  radarDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#0B0D12" },
  radarNote: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, textAlign: "center", paddingHorizontal: spacing.md },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 1, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  sheetTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  sheetSub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  inviteRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: 6 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  ghostText: { ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurfaceSecondary },
});
