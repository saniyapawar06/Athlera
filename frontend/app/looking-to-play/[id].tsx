import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent, timeAgo } from "@/src/theme";
import { api } from "@/src/api";

export default function LtpResponsesScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.ltpResponses(id as string)); }
    catch { setData({ error: true }); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const post = data?.post;
  const accent = post ? sportAccent(post.sport_id) : colors.brand;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="ltp-responses-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ltp-resp-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>RESPONSES</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> :
        data?.error ? <Text style={styles.empty}>Could not load responses.</Text> : (
          <>
            <View style={styles.postCard}>
              <View style={styles.postHead}>
                <View style={[styles.dot, { backgroundColor: accent }]} />
                <Text style={[styles.postSport, { color: accent }]}>{post.sport.name.toUpperCase()}</Text>
              </View>
              <Text style={styles.postWhen}>{post.when_text} · {post.area}</Text>
            </View>

            <Text style={styles.count}>{(data.responses || []).length} PLAYER{(data.responses || []).length === 1 ? "" : "S"} INTERESTED</Text>

            {(data.responses || []).length === 0 ? (
              <Text style={styles.empty}>No responses yet. Share your availability and check back soon.</Text>
            ) : (data.responses || []).map((r: any) => (
              <View key={r.id} style={styles.card} testID={`response-${r.from_user_id}`}>
                <Pressable onPress={() => router.push(`/athlete/${r.from_user_id}`)} style={styles.respRow}>
                  <View style={[styles.avatar, { backgroundColor: accent + "22" }]}>
                    <Text style={[styles.avatarText, { color: accent }]}>{(r.display_name || "A").charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{r.display_name}</Text>
                    <Text style={styles.meta}>{r.city || "—"}{r.rating != null ? ` · Rating ${r.rating}${r.provisional ? " (P)" : ""}` : ""} · {timeAgo(r.created_at)}</Text>
                  </View>
                </Pressable>
                {r.message ? <Text style={styles.msg}>“{r.message}”</Text> : null}
                <View style={styles.actionRow}>
                  <Pressable testID={`resp-message-${r.from_user_id}`} onPress={() => router.push(`/messages/${r.from_user_id}`)} style={styles.miniBtn}>
                    <Ionicons name="chatbubble-outline" size={13} color={colors.onSurfaceSecondary} />
                    <Text style={styles.miniText}>MESSAGE</Text>
                  </Pressable>
                  <Pressable
                    testID={`resp-score-${r.from_user_id}`}
                    onPress={() => router.push(`/live/setup?sport_id=${post.sport_id}&opponent_id=${r.from_user_id}&opponent_name=${encodeURIComponent(r.display_name)}`)}
                    style={[styles.miniBtn, { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary }]}
                  >
                    <Ionicons name="tennisball" size={13} color={colors.brand} />
                    <Text style={[styles.miniText, { color: colors.brand }]}>SCORE MATCH</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 2 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  postCard: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: 6 },
  postHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  postSport: { ...font.textBold, letterSpacing: 1, fontSize: 12 },
  postWhen: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary },
  count: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary },
  empty: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary, marginTop: spacing.sm },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  respRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20 },
  name: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  meta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 1 },
  msg: { ...font.text, fontSize: 13, color: colors.onSurface, fontStyle: "italic" },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  miniText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceSecondary },
});
