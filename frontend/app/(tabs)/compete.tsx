import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

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
  const [tab, setTab] = useState<"competitions" | "events">("competitions");
  const [comps, setComps] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try { const [c, e] = await Promise.all([api.compList(), api.events()]); setComps(c.competitions || []); setEvents(e.events || []); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const fComps = filter === "ALL" ? comps : comps.filter((c) => c.sport_id.toUpperCase() === filter);
  const fEvents = filter === "ALL" ? events : events.filter((e) => e.sport_id.toUpperCase() === filter);

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="compete-screen">
      <View style={styles.stickyHeader}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>COMPETE</Text>
          <Pressable testID="create-comp-btn" onPress={() => router.push("/competition/create?sport_id=squash&type=league")} style={styles.createBtn}>
            <Ionicons name="add" size={18} color="#0B0D12" /><Text style={styles.createText}>CREATE</Text>
          </Pressable>
        </View>
        <View style={styles.segment}>
          {(["competitions", "events"] as const).map((t) => (
            <Pressable key={t} testID={`compete-tab-${t}`} onPress={() => setTab(t)} style={[styles.seg, tab === t && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[styles.segText, tab === t && { color: colors.onSurface }]}>{t.toUpperCase()}</Text>
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
          fEvents.map((e, i) => (
            <Animated.View key={e.id} entering={FadeInDown.delay(50 * i).duration(300)}>
              <View style={styles.eventCard}>
                <Image source={SPORT_IMAGES[e.sport_id]} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient colors={["rgba(11,13,18,0.15)", "rgba(11,13,18,0.92)"]} style={StyleSheet.absoluteFill} />
                <View style={styles.eventInner}>
                  <View style={styles.eventTop}>
                    <Text style={[styles.eSportTag, { color: sportAccent(e.sport_id), borderColor: sportAccent(e.sport_id) }]}>{e.sport_id.toUpperCase()}</Text>
                    <Text style={styles.eDate}>{e.date}</Text>
                  </View>
                  <View>
                    <Text style={styles.eName}>{e.name}</Text>
                    <Text style={styles.eMeta}>{e.city} · {e.venue} · {e.format}</Text>
                    <View style={styles.eBadgeRow}>
                      <Text style={styles.eBadge}>{e.entry_fee}</Text>
                      <Text style={styles.eBadge}>{e.registered}/{e.capacity} REGISTERED</Text>
                    </View>
                  </View>
                </View>
              </View>
            </Animated.View>
          ))
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
  createText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: "#0B0D12" },
  segment: { flexDirection: "row", gap: spacing.sm },
  seg: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  segText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  chipsRow: { height: 42 },
  chipsContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: { flexShrink: 0, height: 34, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  compCard: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  compName: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  compMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  compBadges: { flexDirection: "row", gap: 6, marginTop: 6, alignItems: "center" },
  badge: { ...font.textBold, letterSpacing: 1, fontSize: 9, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  badgeStatus: { ...font.textBold, letterSpacing: 1, fontSize: 9, color: colors.onSurfaceTertiary },
  eventCard: { height: 190, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  eventInner: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  eventTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eSportTag: { ...font.textBold, letterSpacing: 2, fontSize: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: "rgba(11,13,18,0.5)" },
  eDate: { ...font.textBold, fontSize: 11, color: colors.onSurface, backgroundColor: "rgba(11,13,18,0.5)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  eName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  eMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  eBadgeRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  eBadge: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurface, backgroundColor: "rgba(11,13,18,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  empty: { padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", borderRadius: radius.md },
  emptyText: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
});
