import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

export default function SocialScreen() {
  const [feed, setFeed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const r = await api.feed(); setFeed(r.items || []); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="social-screen">
      <View style={styles.header}>
        <Text style={styles.title}>SOCIAL</Text>
        <Text style={styles.subtitle}>Community feed · Nearby players · Play requests</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.quickRow}>
          <Pressable testID="looking-to-play-btn" style={styles.quickBtn}>
            <Ionicons name="megaphone-outline" size={20} color={colors.brand} />
            <Text style={styles.quickText}>LOOKING TO PLAY</Text>
          </Pressable>
          <Pressable testID="nearby-players-btn" style={styles.quickBtn}>
            <Ionicons name="location-outline" size={20} color={colors.brand} />
            <Text style={styles.quickText}>NEARBY PLAYERS</Text>
          </Pressable>
        </View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>COMMUNITY FEED</Text>
          <View style={styles.sectionLine} />
        </View>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} /> :
          feed.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No activity yet</Text>
              <Text style={styles.emptySub}>Play a match to fill the feed.</Text>
            </View>
          ) : feed.map((f) => (
            <View key={f.id} style={styles.postCard} testID={`feed-item-${f.id}`}>
              <View style={styles.postHeader}>
                <View style={[styles.sportDot, { backgroundColor: sportAccent(f.sport_id) }]} />
                <Text style={styles.postSport}>{f.sport_id.toUpperCase()}</Text>
              </View>
              <Text style={styles.postText}>{f.text}</Text>
              <Text style={styles.postScore}>{f.score}</Text>
            </View>
          ))
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.md, gap: 4 },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface, letterSpacing: 2 },
  subtitle: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quickBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  quickText: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurface },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...font.textBold, letterSpacing: 3, fontSize: 11, color: colors.onSurfaceSecondary },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.border },
  postCard: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 6 },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sportDot: { width: 8, height: 8, borderRadius: 4 },
  postSport: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  postText: { ...font.textMedium, fontSize: 14, color: colors.onSurface },
  postScore: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.brand, letterSpacing: 2 },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurface },
  emptySub: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
});
