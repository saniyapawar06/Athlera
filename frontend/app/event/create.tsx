import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { colors, spacing, radius, font, sportAccent, CURRENCIES, countryOf } from "@/src/theme";

const sports = ["squash", "tennis", "padel", "badminton", "pickleball"];

export default function EventCreateScreen() {
  const router = useRouter();
  const [sport, setSport] = useState("squash");
  const [format, setFormat] = useState("league");
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [capacity, setCapacity] = useState("32");
  const [paid, setPaid] = useState(false);
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [customCurrency, setCustomCurrency] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accent = sportAccent(sport);

  const submit = async () => {
    setError("");
    if (!name || !venue || !city) { setError("Add a name, venue and city"); return; }
    const finalCurrency = currency === "Other" ? (customCurrency.trim().toUpperCase() || "USD") : currency;
    if (paid && (!fee || Number(fee) <= 0)) { setError("Enter a valid fee for a paid event"); return; }
    setBusy(true);
    try {
      const r = await api.eventCreate({
        name, sport_id: sport, format, visibility, venue, city,
        country: country.trim() || countryOf(city) || undefined,
        capacity: Number(capacity) || 32,
        is_paid: paid, fee: paid ? Number(fee) : null, currency: finalCurrency,
      });
      router.replace(`/event/${r.event.id}`);
    } catch (e: any) { setError(e?.message || "Could not create event"); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} testID="event-create-screen" edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ec-back"><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>CREATE EVENT</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>SPORT</Text>
          <View style={styles.row}>{sports.map((s) => (
            <Pressable key={s} testID={`ec-sport-${s}`} onPress={() => setSport(s)} style={[styles.pill, sport === s && { borderColor: sportAccent(s), backgroundColor: colors.surfaceTertiary }]}><Text style={styles.pillText}>{s.toUpperCase()}</Text></Pressable>
          ))}</View>

          <Text style={styles.label}>FORMAT</Text>
          <View style={styles.row}>{["league", "knockout"].map((x) => (
            <Pressable key={x} testID={`ec-format-${x}`} onPress={() => setFormat(x)} style={[styles.pill, format === x && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={styles.pillText}>{x.toUpperCase()}</Text></Pressable>
          ))}</View>

          <Field label="EVENT NAME" value={name} onChange={setName} placeholder="City Summer Series" tid="ec-name" />
          <Field label="VENUE" value={venue} onChange={setVenue} placeholder="Club or court" tid="ec-venue" />
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Field label="CITY" value={city} onChange={setCity} placeholder="London" tid="ec-city" /></View>
            <View style={{ flex: 1 }}><Field label="COUNTRY" value={country} onChange={setCountry} placeholder={countryOf(city) || "United Kingdom"} tid="ec-country" /></View>
          </View>

          <Text style={styles.label}>VISIBILITY</Text>
          <View style={styles.row}>{["public", "private"].map((x) => (
            <Pressable key={x} testID={`ec-visibility-${x}`} onPress={() => setVisibility(x)} style={[styles.pill, visibility === x && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
              <Text style={styles.pillText}>{x.toUpperCase()}</Text>
            </Pressable>
          ))}</View>
          <Text style={styles.hint}>{visibility === "public" ? "Shown in public discovery — anyone can register." : "Private — only invited/registered players can see it."}</Text>

          <View style={styles.field}><Text style={styles.label}>CAPACITY</Text>
            <TextInput testID="ec-capacity" value={capacity} onChangeText={(v) => setCapacity(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" style={styles.input} />
          </View>

          {/* Paid / Free dropdown */}
          <Text style={styles.label}>ENTRY</Text>
          <View style={styles.row}>
            {[["FREE", false], ["PAID", true]].map(([lbl, val]) => (
              <Pressable key={lbl as string} testID={`ec-paid-${lbl}`} onPress={() => setPaid(val as boolean)} style={[styles.pill, paid === val && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Text style={styles.pillText}>{lbl as string}</Text>
              </Pressable>
            ))}
          </View>

          {paid && (
            <>
              <View style={styles.field}><Text style={styles.label}>FEE AMOUNT</Text>
                <TextInput testID="ec-fee" value={fee} onChangeText={(v) => setFee(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholder="25" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              </View>
              <Text style={styles.label}>CURRENCY</Text>
              <View style={styles.row}>{CURRENCIES.map((c) => (
                <Pressable key={c} testID={`ec-currency-${c}`} onPress={() => setCurrency(c)} style={[styles.pill, currency === c && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.pillText}>{c.toUpperCase()}</Text>
                </Pressable>
              ))}</View>
              {currency === "Other" && (
                <View style={styles.field}><Text style={styles.label}>CUSTOM CURRENCY (e.g. NZD)</Text>
                  <TextInput testID="ec-currency-custom" value={customCurrency} onChangeText={setCustomCurrency} autoCapitalize="characters" maxLength={5} placeholder="NZD" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
                </View>
              )}
            </>
          )}

          {!!error && <Text style={styles.error} testID="ec-error">{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
      <Pressable onPress={submit} disabled={busy} testID="ec-submit" style={[styles.cta, { backgroundColor: accent }, busy && { opacity: 0.6 }]}>
        {busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>CREATE EVENT</Text>}
      </Pressable>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, tid }: any) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={tid} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 28, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  label: { ...font.textBold, fontSize: 10, letterSpacing: 1.5, color: colors.onSurfaceSecondary },
  hint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pill: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  pillText: { ...font.textBold, fontSize: 11, color: colors.onSurface },
  field: { gap: 6 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, ...font.text, fontSize: 15 },
  error: { ...font.textMedium, color: colors.error },
  cta: { margin: spacing.md, minHeight: 52, borderRadius: radius.md, justifyContent: "center", alignItems: "center" },
  ctaText: { ...font.textBold, color: "#0B0D12", letterSpacing: 1.5 },
});
