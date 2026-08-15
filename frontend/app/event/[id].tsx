import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);

  const load = useCallback(async () => {
    const r = await api.eventDetail(id as string);
    setEvent(r.event);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!event) return <SafeAreaView style={styles.root} edges={["top"]}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;

  const accent = sportAccent(event.sport_id);
  const act = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); await load(); } finally { setBusy(false); } };
  const full = event.registered >= event.capacity && !event.is_registered;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="event-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ev-back"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]} numberOfLines={1}>{event.name}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, { borderLeftColor: accent }]}>
          <Text style={styles.sport}>{event.sport_id.toUpperCase()} · {event.format.toUpperCase()} · {String(event.visibility).toUpperCase()}</Text>
          <Text style={styles.name}>{event.name}</Text>
          <Text style={styles.meta}>{event.venue} · {event.city}{event.country ? `, ${event.country}` : ""}</Text>
        </View>

        {event.is_registered && (
          <View style={[styles.statusBanner, { borderColor: colors.success }]} testID="ev-registered-banner">
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.statusText}>You're registered — you can score matches against other participants.</Text>
          </View>
        )}

        <View style={styles.infoGrid}>
          {[["CAPACITY", `${event.registered}/${event.capacity}`], ["ENTRY", event.is_paid ? `${event.fee} ${event.currency}` : "FREE"], ["STATUS", String(event.status).toUpperCase()]].map(([label, value]) => (
            <View key={label} style={styles.info}>
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoValue}>{value}</Text>
            </View>
          ))}
        </View>

        {!event.is_organiser && (
          <Pressable
            testID="ev-register-btn"
            disabled={busy || full}
            onPress={() => act(event.is_registered ? () => api.eventWithdraw(event.id) : () => api.eventRegister(event.id))}
            style={[styles.cta, { backgroundColor: event.is_registered ? colors.surfaceTertiary : accent, borderWidth: event.is_registered ? 1 : 0, borderColor: colors.border }, full && { opacity: 0.5 }]}
          >
            <Text style={[styles.ctaText, event.is_registered && { color: colors.onSurface }]}>
              {full ? "EVENT FULL" : event.is_registered ? "WITHDRAW REGISTRATION" : "REGISTER FOR EVENT"}
            </Text>
          </Pressable>
        )}

        {event.is_organiser && (
          <View style={styles.orgBar}>
            <Text style={styles.orgLabel}>ORGANISER</Text>
            <Pressable testID="ev-manage-toggle" onPress={() => setManage((m) => !m)} style={[styles.orgBtn, manage && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
              <Ionicons name="construct" size={14} color={manage ? accent : colors.onSurface} />
              <Text style={[styles.orgBtnText, manage && { color: accent }]}>MANAGE</Text>
            </Pressable>
            <Pressable testID="ev-status-toggle" onPress={() => act(() => api.eventManage(event.id, { action: "set_status", status: event.status === "open" ? "closed" : "open" }))} style={styles.orgBtn}>
              <Text style={styles.orgBtnText}>{event.status === "open" ? "CLOSE REG" : "REOPEN"}</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.section}>PARTICIPANTS ({event.participants?.length || 0})</Text>
        {(event.participants || []).length === 0 ? (
          <Text style={styles.hint}>No participants yet.</Text>
        ) : (event.participants || []).map((p: any) => (
          <View key={p.user_id} style={styles.pRow} testID={`ev-participant-${p.user_id}`}>
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/athlete/${p.user_id}`)}>
              <Text style={styles.pName}>{p.display_name}{p.user_id === user?.id ? " (You)" : ""}</Text>
              <Text style={styles.pMeta}>{p.city || "—"}</Text>
            </Pressable>
            {(event.is_registered || event.is_organiser) && p.user_id !== user?.id && (
              <Pressable
                testID={`ev-score-${p.user_id}`}
                onPress={() => router.push(`/live/setup?sport_id=${event.sport_id}&opponent_id=${p.user_id}&opponent_name=${encodeURIComponent(p.display_name)}`)}
                style={[styles.scoreBtn, { borderColor: accent }]}
              >
                <Ionicons name="tennisball" size={13} color={accent} />
                <Text style={[styles.scoreBtnText, { color: accent }]}>SCORE</Text>
              </Pressable>
            )}
            {manage && event.is_organiser && p.user_id !== user?.id && (
              <Pressable testID={`ev-remove-${p.user_id}`} onPress={() => act(() => api.eventManage(event.id, { action: "remove_participant", user_id: p.user_id }))} hitSlop={8} style={{ paddingLeft: spacing.sm }}>
                <Ionicons name="close-circle" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            )}
          </View>
        ))}

        {event.is_organiser && (
          <Text style={styles.hint}>Tip: to run a full draw with fixtures, create a {event.format} competition from the Compete tab and add these players.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, flex: 1, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hero: { borderLeftWidth: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, gap: 8 },
  sport: { ...font.textBold, color: colors.onSurfaceSecondary, letterSpacing: 1.5, fontSize: 11 },
  name: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  meta: { ...font.text, color: colors.onSurfaceSecondary, fontSize: 14 },
  statusBanner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  statusText: { ...font.textMedium, fontSize: 13, color: colors.onSurface, flex: 1 },
  infoGrid: { flexDirection: "row", gap: spacing.sm },
  info: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  infoLabel: { ...font.textBold, color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1.5 },
  infoValue: { ...font.display, fontFamily: "BarlowCondensed", color: colors.onSurface, fontSize: 22, marginTop: 4 },
  cta: { minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ctaText: { ...font.textBold, color: "#0B0D12", letterSpacing: 1.2 },
  orgBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  orgLabel: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  orgBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  orgBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurface },
  section: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  hint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  pRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  pName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  pMeta: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 1 },
  scoreBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  scoreBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 10 },
});
