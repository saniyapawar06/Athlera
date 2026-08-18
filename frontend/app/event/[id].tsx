import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";

const STATUS_META: Record<string, { color: string; label: string }> = {
  Confirmed: { color: colors.success, label: "CONFIRMED" },
  Pending: { color: colors.warning, label: "PAYMENT PENDING" },
  Failed: { color: colors.error, label: "PAYMENT FAILED" },
  Cancelled: { color: colors.onSurfaceTertiary, label: "CANCELLED" },
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pay, setPay] = useState<any | null>(null);      // pending payment info
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.eventDetail(id as string);
    setEvent(r.event);
    if (!name) setName(r.event?.my_registration?.name || user?.display_name || "");
  }, [id, user, name]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!event) return <SafeAreaView style={styles.root} edges={["top"]}><ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /></SafeAreaView>;

  const accent = sportAccent(event.sport_id);
  const reg = event.my_registration;
  const full = event.registered >= event.capacity && !event.is_registered;

  const doRegister = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Enter your name"); return; }
    setBusy(true);
    try {
      const res = await api.eventRegister(event.id, { name: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, notes: notes.trim() || undefined });
      if (res.status === "Confirmed") {
        setShowForm(false); setPay(null); await load();
      } else if (res.pay) {
        setPay(res.pay);
        if (res.pay.mode === "razorpay") setCheckoutUrl(res.pay.checkout_url);
      }
    } catch (e: any) { setErr(e?.message || "Registration failed"); } finally { setBusy(false); }
  };

  const completeTestPayment = async () => {
    if (!pay) return;
    setBusy(true); setErr(null);
    try { await api.eventPayMockConfirm(event.id, pay.registration_id); setPay(null); setShowForm(false); await load(); }
    catch (e: any) { setErr(e?.message || "Could not confirm"); } finally { setBusy(false); }
  };

  const withdraw = async () => {
    setBusy(true);
    try { await api.eventWithdraw(event.id); setPay(null); setShowForm(false); await load(); } finally { setBusy(false); }
  };

  // Razorpay WebView (only reached when live keys are configured)
  if (checkoutUrl) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]} testID="event-checkout">
        <View style={styles.header}>
          <Pressable testID="checkout-cancel" onPress={() => setCheckoutUrl(null)} style={{ padding: 4 }}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          <Text style={[styles.title, { color: accent }]}>SECURE PAYMENT</Text>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          onShouldStartLoadWithRequest={(r) => {
            if (r.url.startsWith("frontend://payment-result")) {
              setCheckoutUrl(null); setPay(null); setShowForm(false);
              setTimeout(() => load(), 400);
              return false;
            }
            return true;
          }}
        />
      </SafeAreaView>
    );
  }

  const info: [string, string, any?][] = [
    ["WHEN", event.starts_at ? new Date(event.starts_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "TBD", "calendar"],
    ["WHERE", `${event.venue}${event.city ? " · " + event.city : ""}${event.country ? ", " + event.country : ""}`, "location"],
    ["ENTRY", event.is_paid ? `${event.fee} ${event.currency}` : "FREE", "pricetag"],
    ["SPOTS", `${event.registered}/${event.capacity}`, "people"],
  ];

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="event-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ed-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]} numberOfLines={1}>{event.name}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { borderLeftColor: accent }]}>
          <Text style={styles.heroTag}>{event.sport_id.toUpperCase()} · {String(event.format).toUpperCase()}</Text>
          <Text style={styles.heroName}>{event.name}</Text>
          {!!event.description && <Text style={styles.heroDesc}>{event.description}</Text>}
        </View>

        {reg && (
          <View style={[styles.statusBar, { borderColor: (STATUS_META[reg.status]?.color || colors.border) }]} testID="registration-status">
            <Ionicons name={reg.status === "Confirmed" ? "checkmark-circle" : reg.status === "Pending" ? "time" : "alert-circle"} size={18} color={STATUS_META[reg.status]?.color || colors.onSurface} />
            <Text style={[styles.statusText, { color: STATUS_META[reg.status]?.color || colors.onSurface }]}>{STATUS_META[reg.status]?.label || reg.status}</Text>
          </View>
        )}

        {info.map(([label, value, icon]) => (
          <View key={label} style={styles.infoRow}>
            <Ionicons name={icon} size={18} color={colors.onSurfaceSecondary} />
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
          </View>
        ))}

        {event.is_organiser && <Text style={styles.hint}>You organise this event. Participants register here.</Text>}

        {/* Test-mode payment prompt */}
        {pay && pay.mode === "test" && (
          <View style={styles.payBox} testID="test-pay-box">
            <Text style={styles.payTitle}>COMPLETE PAYMENT</Text>
            <Text style={styles.paySub}>Test mode — no real card is charged. Amount: {pay.amount} {pay.currency}. Your registration confirms once payment succeeds.</Text>
            <Pressable testID="complete-test-payment" onPress={completeTestPayment} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}>{busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>PAY {pay.amount} {pay.currency} (TEST)</Text>}</Pressable>
          </View>
        )}

        {/* Registration form */}
        {showForm && !pay && (
          <View style={styles.formBox} testID="registration-form">
            <Text style={styles.formTitle}>YOUR DETAILS</Text>
            {event.is_paid && <Text style={styles.feeReview}>You will pay <Text style={{ color: accent }}>{event.fee} {event.currency}</Text> to confirm this registration.</Text>}
            <TextInput testID="reg-name" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <TextInput testID="reg-email" value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="email-address" autoCapitalize="none" style={styles.input} />
            <TextInput testID="reg-phone" value={phone} onChangeText={setPhone} placeholder="Phone (optional)" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="phone-pad" style={styles.input} />
            <TextInput testID="reg-notes" value={notes} onChangeText={setNotes} placeholder="Notes for organiser (optional)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            {err && <Text style={styles.error} testID="reg-error">{err}</Text>}
            <Pressable testID="reg-submit" onPress={doRegister} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}>{busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>{event.is_paid ? "CONTINUE TO PAYMENT" : "CONFIRM REGISTRATION"}</Text>}</Pressable>
            <Pressable testID="reg-cancel" onPress={() => { setShowForm(false); setErr(null); }} style={styles.ghost}><Text style={styles.ghostText}>CANCEL</Text></Pressable>
          </View>
        )}

        {err && !showForm && !pay && <Text style={styles.error} testID="ed-error">{err}</Text>}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Primary CTA */}
      {!showForm && !pay && (
        <View style={styles.footer}>
          {event.is_registered && reg?.status === "Confirmed" ? (
            <Pressable testID="event-withdraw" onPress={withdraw} disabled={busy} style={[styles.cta, styles.withdrawBtn]}><Text style={[styles.ctaText, { color: colors.onSurface }]}>WITHDRAW REGISTRATION</Text></Pressable>
          ) : reg?.status === "Pending" ? (
            <Pressable testID="event-resume-pay" onPress={() => setShowForm(true)} disabled={busy} style={[styles.cta, { backgroundColor: accent }]}><Text style={styles.ctaText}>COMPLETE PAYMENT</Text></Pressable>
          ) : full ? (
            <View style={[styles.cta, styles.disabledBtn]}><Text style={[styles.ctaText, { color: colors.onSurfaceTertiary }]}>EVENT FULL</Text></View>
          ) : (
            <Pressable testID="event-register" onPress={() => { setShowForm(true); setErr(null); }} style={[styles.cta, { backgroundColor: accent }]}><Text style={styles.ctaText}>{event.is_paid ? `REGISTER · ${event.fee} ${event.currency}` : "REGISTER FREE"}</Text></Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, flex: 1, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  hero: { borderLeftWidth: 4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, gap: 6 },
  heroTag: { ...font.textBold, color: colors.onSurfaceSecondary, letterSpacing: 1.5, fontSize: 11 },
  heroName: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 32, color: colors.onSurface },
  heroDesc: { ...font.text, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  statusBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  statusText: { ...font.textBold, letterSpacing: 1.5, fontSize: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  infoLabel: { ...font.textBold, color: colors.onSurfaceTertiary, fontSize: 10, letterSpacing: 1.5, width: 56 },
  infoValue: { ...font.textMedium, color: colors.onSurface, fontSize: 14, flex: 1 },
  hint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  payBox: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  payTitle: { ...font.textBold, letterSpacing: 2, fontSize: 12, color: colors.warning },
  paySub: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 18 },
  formBox: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  formTitle: { ...font.textBold, letterSpacing: 2, fontSize: 12, color: colors.onSurfaceSecondary },
  feeReview: { ...font.textMedium, fontSize: 13, color: colors.onSurface },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.onSurface, backgroundColor: colors.surface, ...font.text, fontSize: 15 },
  error: { ...font.textMedium, color: colors.error, fontSize: 13 },
  ghost: { minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  ghostText: { ...font.textBold, fontSize: 11, letterSpacing: 1, color: colors.onSurfaceSecondary },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { minHeight: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  ctaText: { ...font.textBold, color: "#0B0D12", letterSpacing: 1.2, fontSize: 13 },
  withdrawBtn: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  disabledBtn: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
});
