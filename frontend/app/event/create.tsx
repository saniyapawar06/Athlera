import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import CountryCityPicker from "@/src/components/CountryCityPicker";
import DateTimeField from "@/src/components/DateTimeField";

const sports = ["squash", "tennis", "padel", "badminton", "pickleball"];
const currencies = ["INR", "USD", "GBP", "EUR", "AED"];

export default function EventCreateScreen() {
  const router = useRouter();
  const [sport, setSport] = useState("squash");
  const [format, setFormat] = useState("league");
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("32");
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [paid, setPaid] = useState(false);
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const accent = sportAccent(sport);

  const submit = async () => {
    setError("");
    if (!name.trim() || !venue.trim()) { setError("Add an event name and venue"); return; }
    if (!country || !city) { setError("Select a country and city"); return; }
    if (paid && (!fee || Number(fee) <= 0)) { setError("Enter a valid entry fee"); return; }
    setBusy(true);
    try {
      const r = await api.eventCreate({
        name: name.trim(), sport_id: sport, format, visibility: "public",
        venue: venue.trim(), city, country, description: description.trim() || undefined,
        capacity: Number(capacity) || 32, is_paid: paid, fee: paid ? Number(fee) : null, currency,
        starts_at: startsAt ? startsAt.toISOString() : undefined,
      });
      router.replace(`/event/${r.event.id}`);
    } catch (e: any) { setError(e?.message || "Could not create event"); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="event-create-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ec-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>CREATE EVENT</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.helper}>Public events appear in Events discovery and can be paid. Private Leagues/Knockouts stay on your sport page and never need this.</Text>

          <Text style={styles.label}>SPORT</Text>
          <View style={styles.row}>{sports.map((s) => <Pressable key={s} testID={`ec-sport-${s}`} onPress={() => setSport(s)} style={[styles.pill, sport === s && { borderColor: sportAccent(s), backgroundColor: colors.surfaceTertiary }]}><Text style={styles.pillText}>{s.toUpperCase()}</Text></Pressable>)}</View>

          <Text style={styles.label}>FORMAT</Text>
          <View style={styles.row}>{["league", "knockout"].map((x) => <Pressable key={x} testID={`ec-format-${x}`} onPress={() => setFormat(x)} style={[styles.pill, format === x && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={styles.pillText}>{x.toUpperCase()}</Text></Pressable>)}</View>

          <View style={styles.field}><Text style={styles.label}>EVENT NAME</Text><TextInput testID="ec-name" value={name} onChangeText={setName} placeholder="City Summer Series" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>
          <View style={styles.field}><Text style={styles.label}>VENUE</Text><TextInput testID="ec-venue" value={venue} onChangeText={setVenue} placeholder="Club or court name" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></View>

          <CountryCityPicker country={country} city={city} accent={accent} onChange={(v) => { setCountry(v.country); setCity(v.city); }} />

          <View style={styles.field}><Text style={styles.label}>EVENT DATE & TIME</Text><DateTimeField value={startsAt} onChange={setStartsAt} accent={accent} testIDPrefix="ec-dt" /><Text style={styles.subHelper}>Overall event date — separate from individual fixture times.</Text></View>

          <View style={styles.field}><Text style={styles.label}>DESCRIPTION (OPTIONAL)</Text><TextInput testID="ec-desc" value={description} onChangeText={setDescription} placeholder="What players should know" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { height: 80, textAlignVertical: "top" }]} multiline /></View>

          <View style={styles.field}><Text style={styles.label}>CAPACITY</Text><TextInput testID="ec-capacity" value={capacity} onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" style={styles.input} /></View>

          <Pressable testID="ec-toggle-paid" onPress={() => setPaid(!paid)} style={styles.toggle}>
            <View><Text style={styles.toggleText}>{paid ? "PAID ENTRY" : "FREE ENTRY"}</Text><Text style={styles.subHelper}>{paid ? "Players pay before registration is confirmed" : "Players register instantly"}</Text></View>
            <Ionicons name={paid ? "checkmark-circle" : "ellipse-outline"} size={24} color={accent} />
          </Pressable>

          {paid && (
            <View style={styles.field}>
              <Text style={styles.label}>ENTRY FEE</Text>
              <View style={styles.row}>
                <TextInput testID="ec-fee" value={fee} onChangeText={(v) => setFee(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" style={[styles.input, { flex: 1 }]} placeholder="25" placeholderTextColor={colors.onSurfaceTertiary} />
              </View>
              <View style={[styles.row, { marginTop: 6 }]}>{currencies.map((c) => <Pressable key={c} testID={`ec-currency-${c}`} onPress={() => setCurrency(c)} style={[styles.pill, currency === c && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={styles.pillText}>{c}</Text></Pressable>)}</View>
            </View>
          )}

          {!!error && <Text style={styles.error} testID="ec-error">{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
      <Pressable testID="ec-submit" onPress={submit} disabled={busy} style={[styles.cta, { backgroundColor: accent }, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>CREATE EVENT</Text>}</Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  helper: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary, lineHeight: 17 },
  subHelper: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4 },
  label: { ...font.textBold, fontSize: 10, letterSpacing: 1.5, color: colors.onSurfaceSecondary },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pill: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  pillText: { ...font.textBold, fontSize: 11, color: colors.onSurface },
  field: { gap: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, ...font.text, fontSize: 15 },
  toggle: { minHeight: 56, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  toggleText: { ...font.textBold, color: colors.onSurface, letterSpacing: 1, fontSize: 13 },
  error: { ...font.textMedium, color: colors.error, fontSize: 13 },
  cta: { margin: spacing.md, minHeight: 52, borderRadius: radius.md, justifyContent: "center", alignItems: "center" },
  ctaText: { ...font.textBold, color: "#0B0D12", letterSpacing: 1.5, fontSize: 13 },
});
