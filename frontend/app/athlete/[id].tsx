import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { request } from "@/src/api";

export default function AthleteProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await request(`/athletes/${id}`)); }
    catch { setData(null); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="athlete-profile-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="athlete-back-btn" style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>ATHLETE</Text>
      </View>
      {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xxl }} /> :
        !data ? <Text style={styles.err}>Could not load athlete.</Text> : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.identity}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(data.user.display_name || "A").slice(0, 1).toUpperCase()}</Text></View>
            <Text style={styles.name}>{data.user.display_name}</Text>
            <Text style={styles.username}>@{data.user.username || "athlete"}</Text>
            {data.user.city && <Text style={styles.city}>{data.user.city}</Text>}
          </View>
          <View style={styles.uasBox}>
            <Text style={styles.uasLabel}>UNIVERSAL ATHLETE SCORE</Text>
            <Text style={styles.uasValue}>{data.uas}<Text style={styles.uasMax}> / 1000</Text></Text>
          </View>
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>SPORTS & RATINGS</Text><View style={styles.line} /></View>
          {data.cards.map((c: any) => (
            <View key={c.sport_id} style={[styles.sportRow, { borderLeftColor: c.accent }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sportName, { color: c.accent }]}>{c.sport_name.toUpperCase()}</Text>
                <Text style={styles.sportMeta}>{c.band} · Rank #{c.rank}{c.provisional ? " · Provisional" : ""}</Text>
              </View>
              <Text style={styles.sportRating}>{formatRating(c.rating, c.decimals)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  backBtn: { padding: 4 },
  headerTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 2 },
  err: { ...font.text, color: colors.error, padding: spacing.lg },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", gap: 4 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surfaceTertiary, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 40, color: colors.onSurface },
  name: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, color: colors.onSurface, marginTop: spacing.sm },
  username: { ...font.textMedium, fontSize: 12, color: colors.onSurfaceSecondary, letterSpacing: 1 },
  city: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  uasBox: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderLeftWidth: 4, borderLeftColor: colors.brand },
  uasLabel: { ...font.textBold, letterSpacing: 3, fontSize: 10, color: colors.onSurfaceSecondary },
  uasValue: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 52, color: colors.onSurface },
  uasMax: { ...font.text, fontSize: 16, color: colors.onSurfaceTertiary },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...font.textBold, letterSpacing: 3, fontSize: 11, color: colors.onSurfaceSecondary },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  sportRow: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  sportName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, letterSpacing: 2 },
  sportMeta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  sportRating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, color: colors.onSurface },
});
