import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
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
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    try { const r = await api.events(); setEvents(r.events || []); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === "ALL" ? events : events.filter((e) => e.sport_id.toUpperCase() === filter);

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="compete-screen">
      <View style={styles.stickyHeader}>
        <Text style={styles.title}>COMPETE</Text>
        <Text style={styles.subtitle}>Leagues · Tournaments · Knockouts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
          {CHIPS.map((c) => (
            <Pressable
              key={c}
              testID={`compete-chip-${c}`}
              onPress={() => setFilter(c)}
              style={[styles.chip, filter === c && { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}
            >
              <Text style={[styles.chipText, filter === c && { color: colors.onSurface }]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
        filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No events for this filter</Text>
            <Text style={styles.emptySub}>Try a different sport.</Text>
          </View>
        ) : filtered.map((e, i) => (
          <Animated.View key={e.id} entering={FadeInDown.delay(60 * i).duration(400)}>
            <Pressable
              testID={`event-card-${e.id}`}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            >
              <Image source={SPORT_IMAGES[e.sport_id]} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient colors={["rgba(11,13,18,0.15)", "rgba(11,13,18,0.9)"]} style={StyleSheet.absoluteFill} />
              <View style={styles.cardInner}>
                <View style={styles.cardTop}>
                  <View style={[styles.sportTag, { borderColor: sportAccent(e.sport_id) }]}>
                    <Text style={[styles.sportTagText, { color: sportAccent(e.sport_id) }]}>{e.sport_id.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.dateText}>{e.date}</Text>
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.eventName} numberOfLines={2}>{e.name}</Text>
                  <Text style={styles.eventMeta}>{e.city} · {e.venue} · {e.format}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaChip}>{e.entry_fee}</Text>
                    <Text style={styles.metaChip}>{e.registered}/{e.capacity} REGISTERED</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  stickyHeader: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface, gap: 4 },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  chipsRow: { marginTop: spacing.sm, height: 44 },
  chipsContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: { flexShrink: 0, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { height: 200, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  cardInner: { flex: 1, padding: spacing.md, justifyContent: "space-between" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sportTag: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: radius.sm, backgroundColor: "rgba(11,13,18,0.5)" },
  sportTagText: { ...font.textBold, letterSpacing: 2, fontSize: 10 },
  dateText: { ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurface, backgroundColor: "rgba(11,13,18,0.5)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  cardBottom: { gap: 4 },
  eventName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface },
  eventMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  metaRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  metaChip: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurface, backgroundColor: "rgba(11,13,18,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm },
  empty: { alignItems: "center", padding: spacing.xl, gap: 4 },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
});
