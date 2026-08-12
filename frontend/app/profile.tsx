import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.dashboard()); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="profile-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="profile-back-btn" style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>PROFILE</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.display_name || "A").slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user?.display_name || "Athlete"}</Text>
          <Text style={styles.username}>@{user?.username || "athlete"}{user?.is_guest ? " · GUEST" : ""}</Text>
          {user?.city && <Text style={styles.city}>{user.city}</Text>}
        </View>

        {loading ? <ActivityIndicator color={colors.brand} /> : (
          <>
            <View style={styles.uasBox}>
              <Text style={styles.uasLabel}>UNIVERSAL ATHLETE SCORE</Text>
              <Text style={styles.uasValue}>{data?.uas ?? 0}<Text style={styles.uasMax}> / 1000</Text></Text>
            </View>

            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>SPORTS & RATINGS</Text><View style={styles.line} /></View>
            {(data?.cards ?? []).map((c: any) => (
              <Pressable key={c.sport_id} testID={`profile-sport-${c.sport_id}`} onPress={() => router.push(`/sport/${c.sport_id}`)} style={[styles.sportRow, { borderLeftColor: c.accent }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sportName, { color: c.accent }]}>{c.sport_name.toUpperCase()}</Text>
                  <Text style={styles.sportMeta}>{c.band} · Rank #{c.rank}{c.provisional ? " · Provisional" : ""}</Text>
                </View>
                <Text style={styles.sportRating}>{formatRating(c.rating, c.decimals)}</Text>
              </Pressable>
            ))}

            <Pressable testID="add-sport-btn" onPress={() => router.push("/onboarding/sports")} style={styles.addBtn}>
              <Ionicons name="add-circle-outline" size={20} color={colors.brand} />
              <Text style={styles.addBtnText}>ADD ANOTHER SPORT</Text>
            </Pressable>

            {user?.is_guest && (
              <Pressable testID="create-account-btn" onPress={() => router.push("/auth")} style={styles.upgradeBtn}>
                <Text style={styles.upgradeBtnText}>CREATE AN ACCOUNT TO SAVE PROGRESS</Text>
              </Pressable>
            )}

            <Pressable testID="profile-logout-btn" onPress={async () => { await logout(); router.replace("/"); }} style={styles.logoutBtn}>
              <Text style={styles.logoutBtnText}>LOG OUT</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  backBtn: { padding: 4 },
  headerTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 2 },
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
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed", borderRadius: radius.md },
  addBtnText: { ...font.textBold, letterSpacing: 1.5, fontSize: 12, color: colors.onSurface },
  upgradeBtn: { padding: spacing.md, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.brand },
  upgradeBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 12, color: colors.onBrand },
  logoutBtn: { padding: spacing.md, alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  logoutBtnText: { ...font.textBold, letterSpacing: 2, fontSize: 12, color: colors.error },
});
