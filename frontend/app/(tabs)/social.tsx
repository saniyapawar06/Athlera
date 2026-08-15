import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { FeedCard, FeedItem } from "@/src/components/FeedCard";
import * as Location from "expo-location";

type Tab = "feed" | "nearby" | "ltp" | "requests";

export default function SocialScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feed");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [nearby, setNearby] = useState<any[]>([]);
  const [ltp, setLtp] = useState<any[]>([]);
  const [reqs, setReqs] = useState<{ incoming: any[]; outgoing: any[] }>({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [locationState, setLocationState] = useState<"checking" | "granted" | "manual">("checking");
  const [city, setCity] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, n, l, r] = await Promise.all([api.feed(), api.nearby(), api.ltpList(), api.playRequestsMine()]);
      setFeed(f.items || []); setNearby(n.players || []); setLtp(l.posts || []); setReqs(r);
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      setLocationState(permission.status === "granted" ? "granted" : "manual");
    })();
  }, []);

  const reqAction = async (rid: string, action: string) => {
    setBusy(true);
    try { await api.playRequestAction(rid, action); await load(); } finally { setBusy(false); }
  };

  const respondInterested = async (postId: string) => {
    setBusy(true);
    try { await api.ltpRespond(postId, {}); await load(); } catch { /* dup */ } finally { setBusy(false); }
  };

  const respondMessage = async (postId: string, creatorId: string) => {
    setBusy(true);
    try { await api.ltpRespond(postId, { start_conversation: true }); }
    catch { /* noop */ }
    finally { setBusy(false); router.push(`/messages/${creatorId}`); }
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
        {(["feed", "nearby", "ltp", "requests"] as Tab[]).map((t) => (
          <Pressable key={t} testID={`social-tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && { borderBottomColor: colors.brand }]}>
            <Text style={[styles.tabText, tab === t && { color: colors.onSurface }]}>{t === "ltp" ? "PLAY" : t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "nearby" && locationState !== "granted" && (
        <View style={styles.locationBanner}>
          <Ionicons name="location-outline" size={18} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationTitle}>Choose your city to discover nearby play</Text>
            <TextInput value={city} onChangeText={setCity} placeholder="City or general area" placeholderTextColor={colors.onSurfaceTertiary} style={styles.cityInput} />
          </View>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
        tab === "feed" ? (
          feed.length === 0 ? <Empty t="No activity yet — score a match to start the feed" /> :
          feed.map((it) => (
            <FeedCard key={it.id} item={it} onChanged={(u) => setFeed((prev) => prev.map((x) => x.id === u.id ? { ...x, ...u } : x))} />
          ))
        ) :
        tab === "nearby" ? (
          nearby.length === 0 ? <Empty t="No players nearby" /> :
          nearby.map((p) => (
            <View key={p.user_id + p.sport_id} style={styles.card} testID={`nearby-${p.user_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.display_name}</Text>
                <Text style={styles.meta}>{p.area} · ~{p.distance_km} km · <Text style={{ color: sportAccent(p.sport_id) }}>{p.sport.name}</Text> {p.rating}</Text>
                <View style={styles.actionRow}>
                  <Pressable testID={`view-${p.user_id}`} onPress={() => router.push(`/athlete/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>PROFILE</Text></Pressable>
                  <Pressable testID={`ask-${p.user_id}`} onPress={() => askToPlay(p.user_id, p.sport_id)} disabled={busy} style={[styles.miniBtn, { borderColor: colors.brand }]}><Text style={[styles.miniText, { color: colors.brand }]}>ASK TO PLAY</Text></Pressable>
                  <Pressable testID={`msg-${p.user_id}`} onPress={() => router.push(`/messages/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>MESSAGE</Text></Pressable>
                </View>
              </View>
            </View>
          ))
        ) : tab === "ltp" ? (
          ltp.length === 0 ? <Empty t="No open posts — create one" /> :
          ltp.map((p) => (
            <View key={p.id} style={styles.card} testID={`ltp-${p.id}`}>
              <View style={styles.ltpHead}>
                <View style={[styles.sportDot, { backgroundColor: sportAccent(p.sport_id) }]} />
                <Text style={styles.ltpSport}>{p.sport.name.toUpperCase()}</Text>
                <Text style={styles.ltpBy}>· {p.display_name}{p.is_mine ? " (You)" : ""}</Text>
              </View>
              <Text style={styles.ltpWhen}>{p.when_text} · {p.area} · within {p.radius_km}km</Text>
              {p.message ? <Text style={styles.ltpMsg}>“{p.message}”</Text> : null}
              {p.is_mine ? (
                <View style={styles.actionRow}>
                  <View style={[styles.miniBtn, { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
                    <Text style={[styles.miniText, { color: colors.brand }]}>{p.response_count || 0} INTERESTED</Text>
                  </View>
                  <Pressable testID={`ltp-responses-${p.id}`} onPress={() => router.push(`/looking-to-play/${p.id}`)} style={styles.miniBtn}>
                    <Text style={styles.miniText}>VIEW RESPONSES</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.actionRow}>
                  <Pressable testID={`ltp-profile-${p.id}`} onPress={() => router.push(`/athlete/${p.user_id}`)} style={styles.miniBtn}><Text style={styles.miniText}>PROFILE</Text></Pressable>
                  <Pressable testID={`ltp-interested-${p.id}`} disabled={busy || p.has_responded} onPress={() => respondInterested(p.id)} style={[styles.miniBtn, { borderColor: colors.brand }, p.has_responded && { opacity: 0.6 }]}>
                    <Text style={[styles.miniText, { color: colors.brand }]}>{p.has_responded ? "INTERESTED ✓" : "I'M INTERESTED"}</Text>
                  </Pressable>
                  <Pressable testID={`ltp-msg-${p.id}`} onPress={() => respondMessage(p.id, p.user_id)} style={styles.miniBtn}><Text style={styles.miniText}>MESSAGE</Text></Pressable>
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
                  {r.status === "pending" && <Pressable testID={`cancel-${r.id}`} onPress={() => reqAction(r.id, "cancel")} style={[styles.miniBtn, { alignSelf: "flex-start", marginTop: 6 }]}><Text style={styles.miniText}>CANCEL</Text></Pressable>}
                </View>
              ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Empty({ t }: { t: string }) {
  return <View style={styles.empty}><Text style={styles.emptyText}>{t}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  newBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onBrand },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { ...font.textBold, letterSpacing: 0.5, fontSize: 10, color: colors.onSurfaceTertiary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 6 },
  locationBanner: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  locationTitle: { ...font.textMedium, fontSize: 12, color: colors.onSurface },
  cityInput: { marginTop: 6, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingVertical: 4, color: colors.onSurface, ...font.text, fontSize: 13 },
  name: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  meta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: 8, flexWrap: "wrap" },
  miniBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  miniText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  ltpHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sportDot: { width: 8, height: 8, borderRadius: 4 },
  ltpSport: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurface },
  ltpBy: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  ltpWhen: { ...font.textMedium, fontSize: 13, color: colors.onSurface },
  ltpMsg: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, fontStyle: "italic" },
  groupLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  empty: { padding: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, borderStyle: "dashed" },
  emptyText: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
});
