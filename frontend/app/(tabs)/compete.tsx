import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Location from "expo-location";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";
import { cacheGet, cacheSet } from "@/src/utils/cache";
import CountryCityPicker from "@/src/components/CountryCityPicker";
import DateTimeField from "@/src/components/DateTimeField";

const SPORT_IMAGES: Record<string, string> = {
  tennis: "https://images.unsplash.com/photo-1545151414-8a948e1ea54f?crop=entropy&cs=srgb&fm=jpg&w=800&q=70",
  padel: "https://images.unsplash.com/photo-1508129214940-7b2223ae0a08?crop=entropy&cs=srgb&fm=jpg&w=800&q=70",
  squash: "https://images.pexels.com/photos/8007134/pexels-photo-8007134.jpeg?w=800",
  badminton: "https://images.pexels.com/photos/14605729/pexels-photo-14605729.jpeg?w=800",
  pickleball: "https://images.pexels.com/photos/29439346/pexels-photo-29439346.jpeg?w=800",
};
const CHIPS = ["ALL", "SQUASH", "PADEL", "TENNIS", "BADMINTON", "PICKLEBALL"];

export default function CompeteScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"mine" | "competitions" | "events">("mine");
  const [myComps, setMyComps] = useState<any[]>(() => cacheGet("myComps") ?? []);
  const [comps, setComps] = useState<any[]>(() => cacheGet("comps") ?? []);
  const [events, setEvents] = useState<any[]>(() => cacheGet("events") ?? []);
  const [loading, setLoading] = useState(() => !cacheGet("myComps"));
  const [filter, setFilter] = useState("ALL");

  // Events discovery filters
  const [evCountry, setEvCountry] = useState<string | null>(null);
  const [evCity, setEvCity] = useState<string | null>(null);
  const [evPaid, setEvPaid] = useState<"ALL" | "FREE" | "PAID">("ALL");
  const [evDate, setEvDate] = useState<Date | null>(null);
  const [evNearCity, setEvNearCity] = useState<string | null>(null);
  const [showEvFilters, setShowEvFilters] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, c, e] = await Promise.all([api.compMine(), api.compList(), api.events()]);
      const mc = mine.competitions || []; const cc = c.competitions || []; const ee = e.events || [];
      setMyComps(mc); setComps(cc); setEvents(ee);
      cacheSet("myComps", mc); cacheSet("comps", cc); cacheSet("events", ee);
    } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Re-fetch events whenever discovery filters change.
  const loadEvents = useCallback(async () => {
    const p: Record<string, string> = {};
    if (filter !== "ALL") p.sport_id = filter.toLowerCase();
    if (evCountry) p.country = evCountry;
    if (evCity) p.city = evCity;
    if (evPaid !== "ALL") p.paid = evPaid.toLowerCase();
    if (evDate) p.date = evDate.toISOString().slice(0, 10);
    if (evNearCity) p.near_city = evNearCity;
    try { const e = await api.events(p); setEvents(e.events || []); } catch { /* noop */ }
  }, [filter, evCountry, evCity, evPaid, evDate, evNearCity]);

  useEffect(() => { if (tab === "events") loadEvents(); }, [tab, loadEvents]);

  const useNearby = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      const places = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const c = places?.[0]?.city || places?.[0]?.subregion || null;
      if (c) setEvNearCity(c);
    } catch { /* denied / unavailable — user can filter manually */ }
  };

  const fMine = filter === "ALL" ? myComps : myComps.filter((c) => c.sport_id.toUpperCase() === filter);
  const fComps = filter === "ALL" ? comps : comps.filter((c) => c.sport_id.toUpperCase() === filter);
  const fEvents = filter === "ALL" ? events : events.filter((e) => e.sport_id.toUpperCase() === filter);

  const nextFixtureLabel = (nf: any) => {
    if (!nf) return null;
    const when = nf.scheduled_at ? new Date(nf.scheduled_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : (nf.status === "unscheduled" ? "TBD" : nf.status);
    return `Next: ${nf.round_name}${nf.opponent_name ? ` vs ${nf.opponent_name}` : ""} · ${when}`;
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="compete-screen">
      <View style={styles.stickyHeader}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>COMPETE</Text>
          <Pressable testID="create-comp-btn" onPress={() => router.push(tab === "events" ? "/event/create" : "/competition/create?sport_id=squash&type=league")} style={styles.createBtn}>
            <Ionicons name="add" size={18} color={colors.onBrand} /><Text style={styles.createText}>{tab === "events" ? "CREATE EVENT" : "CREATE"}</Text>
          </Pressable>
        </View>
        <View style={styles.segment}>
          {(["mine", "competitions", "events"] as const).map((t) => (
            <Pressable key={t} testID={`compete-tab-${t}`} onPress={() => setTab(t)} style={[styles.seg, tab === t && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[styles.segText, tab === t && { color: colors.onSurface }]} numberOfLines={1}>{t === "mine" ? "MY COMPS" : t === "competitions" ? "DISCOVER" : "EVENTS"}</Text>
            </Pressable>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
          {CHIPS.map((c) => (
            <Pressable key={c} testID={`compete-chip-${c}`} onPress={() => setFilter(c)} style={[styles.chip, filter === c && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[styles.chipText, filter === c && { color: colors.onSurface }]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
        tab === "mine" ? (
          fMine.length === 0 ? <Empty t="You haven't created or joined any competitions yet. Tap CREATE, or join one from DISCOVER." /> :
          fMine.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.delay(50 * i).duration(300)}>
              <Pressable testID={`mine-comp-${c.id}`} onPress={() => router.push(`/competition/${c.id}`)} style={[styles.compCard, { borderLeftColor: sportAccent(c.sport_id) }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.compName}>{c.name}</Text>
                  <Text style={styles.compMeta}>{c.type.toUpperCase()} · {c.member_count} players</Text>
                  <View style={styles.compBadges}>
                    <Text style={[styles.badge, { color: sportAccent(c.sport_id), borderColor: sportAccent(c.sport_id) }]}>{c.sport.name.toUpperCase()}</Text>
                    <Text style={[styles.roleBadge, c.my_role === "organiser" && { color: colors.brand, borderColor: colors.brand }]}>{c.my_role === "organiser" ? "ORGANISER" : "PLAYER"}</Text>
                    <Text style={styles.badgeStatus}>{c.status.replace(/_/g, " ").toUpperCase()}</Text>
                  </View>
                  {c.next_fixture && <Text style={styles.nextFixture} numberOfLines={1}>{nextFixtureLabel(c.next_fixture)}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            </Animated.View>
          ))
        ) :
        tab === "competitions" ? (
          fComps.length === 0 ? <Empty t="No competitions yet — tap CREATE" /> :
          fComps.map((c, i) => (
            <Animated.View key={c.id} entering={FadeInDown.delay(50 * i).duration(300)}>
              <Pressable testID={`compete-comp-${c.id}`} onPress={() => router.push(`/competition/${c.id}`)} style={[styles.compCard, { borderLeftColor: sportAccent(c.sport_id) }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.compName}>{c.name}</Text>
                  <Text style={styles.compMeta}>{c.type.toUpperCase()} · {c.city || "—"} · {c.member_count} players</Text>
                  <View style={styles.compBadges}>
                    <Text style={[styles.badge, { color: sportAccent(c.sport_id), borderColor: sportAccent(c.sport_id) }]}>{c.sport.name.toUpperCase()}</Text>
                    <Text style={styles.badgeStatus}>{c.status.replace(/_/g, " ").toUpperCase()}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            </Animated.View>
          ))
        ) : (
          <>
            <View style={styles.filterBar}>
              <Pressable testID="ev-nearby" onPress={useNearby} style={[styles.filterChip, evNearCity && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="navigate" size={13} color={evNearCity ? colors.brand : colors.onSurfaceTertiary} />
                <Text style={[styles.filterChipText, evNearCity && { color: colors.onSurface }]} numberOfLines={1}>{evNearCity ? `NEAR ${evNearCity.toUpperCase()}` : "NEARBY"}</Text>
              </Pressable>
              {(["ALL", "FREE", "PAID"] as const).map((p) => (
                <Pressable key={p} testID={`ev-paid-${p}`} onPress={() => setEvPaid(p)} style={[styles.filterChip, evPaid === p && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={[styles.filterChipText, evPaid === p && { color: colors.onSurface }]}>{p}</Text>
                </Pressable>
              ))}
              <Pressable testID="ev-more-filters" onPress={() => setShowEvFilters((s) => !s)} style={[styles.filterChip, (evCountry || evCity || evDate) && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="options" size={13} color={colors.onSurfaceTertiary} />
                <Text style={styles.filterChipText}>MORE</Text>
              </Pressable>
            </View>
            {showEvFilters && (
              <View style={styles.filterPanel} testID="ev-filter-panel">
                <CountryCityPicker country={evCountry} city={evCity} onChange={(v) => { setEvCountry(v.country); setEvCity(v.city); }} />
                <Text style={styles.filterLabel}>ON DATE (OPTIONAL)</Text>
                <DateTimeField value={evDate} onChange={setEvDate} testIDPrefix="ev-date" />
                <Pressable testID="ev-clear-filters" onPress={() => { setEvCountry(null); setEvCity(null); setEvDate(null); setEvNearCity(null); setEvPaid("ALL"); }} style={styles.clearFilters}>
                  <Text style={styles.clearFiltersText}>CLEAR ALL FILTERS</Text>
                </Pressable>
              </View>
            )}
            {fEvents.length === 0 ? (
              <Empty t="No public events match. Adjust filters, or create one." />
            ) : fEvents.map((e, i) => (
              <Animated.View key={e.id} entering={FadeInDown.delay(50 * i).duration(300)}>
                <Pressable testID={`event-card-${e.id}`} onPress={() => router.push(`/event/${e.id}`)} style={styles.eventCard}>
                  <Image source={SPORT_IMAGES[e.sport_id]} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <LinearGradient colors={["rgba(11,13,18,0.15)", "rgba(11,13,18,0.92)"]} style={StyleSheet.absoluteFill} />
                  <View style={styles.eventInner}>
                    <View style={styles.eventTop}>
                      <Text style={[styles.eSportTag, { color: sportAccent(e.sport_id), borderColor: sportAccent(e.sport_id) }]}>{e.sport_id.toUpperCase()}</Text>
                      <Text style={styles.eDate}>{e.starts_at ? new Date(e.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "TBD"}</Text>
                    </View>
                    <View>
                      <Text style={styles.eName}>{e.name}</Text>
                      <Text style={styles.eMeta}>{e.city}{e.country ? `, ${e.country}` : ""} · {e.venue}</Text>
                      <View style={styles.eBadgeRow}>
                        <Text style={styles.eBadge}>{e.entry_fee}</Text>
                        <Text style={styles.eBadge}>{e.registered}/{e.capacity} REGISTERED</Text>
                        {e.is_registered && <Text style={[styles.eBadge, { color: colors.success }]}>YOU'RE IN</Text>}
                        {e.same_city && <Text style={[styles.eBadge, { color: colors.brand }]}>NEARBY</Text>}
                      </View>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
          </>
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
  stickyHeader: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  createText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onBrand },
  segment: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  segText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  chipsRow: { height: 42 },
  chipsContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: { flexShrink: 0, height: 34, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  filterBar: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8, backgroundColor: colors.surfaceSecondary },
  filterChipText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary },
  filterPanel: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  filterLabel: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurfaceSecondary },
  clearFilters: { alignItems: "center", paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  clearFiltersText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  compCard: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compName: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  compMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  compBadges: { flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" },
  badge: { ...font.textBold, letterSpacing: 1, fontSize: 9, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  badgeStatus: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  roleBadge: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceSecondary, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  nextFixture: { ...font.text, fontSize: 11, color: colors.brand, marginTop: 6 },
  eventCard: { height: 190, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  eventInner: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  eventTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eSportTag: { ...font.textBold, letterSpacing: 2, fontSize: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: "rgba(11,13,18,0.5)" },
  eDate: { ...font.textBold, fontSize: 11, color: "#FFFFFF", backgroundColor: "rgba(11,13,18,0.5)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  eName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: "#FFFFFF" },
  eMeta: { ...font.text, fontSize: 12, color: "rgba(255,255,255,0.85)" },
  eBadgeRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  eBadge: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: "#FFFFFF", backgroundColor: "rgba(11,13,18,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  empty: { padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md },
  emptyText: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
});
