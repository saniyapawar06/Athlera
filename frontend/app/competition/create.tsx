import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

const CURRENCIES = ["USD", "GBP", "EUR", "INR", "AED", "AUD", "CAD", "SGD"];

export default function CompetitionCreateScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sport_id: string; type: string }>();
  const [sid, setSid] = useState<string>((params.sport_id as string) || "squash");
  const accent = sportAccent(sid);
  const ALL_SPORTS = ["squash", "padel", "tennis", "badminton", "pickleball"];
  const [name, setName] = useState("");
  const [type, setType] = useState<string>((params.type as string) || "league");
  const [visibility, setVisibility] = useState("public");
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [mpo, setMpo] = useState(1);
  const [playoff, setPlayoff] = useState(0);
  const [maxP, setMaxP] = useState(16);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setErr(null);
    if (!name.trim()) { setErr("Name is required"); return; }
    if (visibility === "public" && !city.trim()) { setErr("Public competitions need a city"); return; }
    setBusy(true);
    try {
      const res = await api.compCreate({
        name: name.trim(), sport_id: sid, type, visibility, city: city.trim() || null,
        venue: venue.trim() || null, entry_fee: fee.trim() || null, currency,
        matches_per_opponent: mpo, playoff_qualifiers: playoff, max_participants: maxP,
      });
      router.replace(`/competition/${res.competition.id}`);
    } catch (e: any) { setErr(e?.message || "Could not create"); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="competition-create-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="cc-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={[styles.title, { color: accent }]}>NEW {(sid || "").toUpperCase()} COMP</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>SPORT</Text>
          <View style={styles.row}>
            {ALL_SPORTS.map((s) => (
              <Pressable key={s} testID={`cc-sport-${s}`} onPress={() => setSid(s)} style={[styles.pill, sid === s && { borderColor: sportAccent(s), backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.pillText, sid === s && { color: sportAccent(s) }]}>{s.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="COMPETITION NAME"><TextInput testID="cc-name" value={name} onChangeText={setName} placeholder="e.g. Winter Squash League" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></Field>

          <Text style={styles.label}>FORMAT</Text>
          <View style={styles.row}>
            {["league", "knockout", "tournament"].map((t) => (
              <Pressable key={t} testID={`cc-type-${t}`} onPress={() => setType(t)} style={[styles.pill, type === t && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.pillText, type === t && { color: colors.onSurface }]}>{t.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>VISIBILITY</Text>
          <View style={styles.row}>
            {["public", "private"].map((v) => (
              <Pressable key={v} testID={`cc-vis-${v}`} onPress={() => setVisibility(v)} style={[styles.pill, visibility === v && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Text style={[styles.pillText, visibility === v && { color: colors.onSurface }]}>{v.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <Field label="CITY"><TextInput testID="cc-city" value={city} onChangeText={setCity} placeholder="London" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></Field>
          <Field label="VENUE (optional)"><TextInput testID="cc-venue" value={venue} onChangeText={setVenue} placeholder="Club / court" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} /></Field>

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}><Field label="ENTRY FEE (optional)"><TextInput testID="cc-fee" value={fee} onChangeText={setFee} placeholder="25" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} keyboardType="decimal-pad" /></Field></View>
            <View style={{ width: 110 }}>
              <Text style={styles.label}>CURRENCY</Text>
              <ScrollView style={{ maxHeight: 52 }} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {CURRENCIES.map((c) => (<Pressable key={c} onPress={() => setCurrency(c)} style={[styles.curChip, currency === c && { borderColor: accent }]}><Text style={[styles.pillText, currency === c && { color: colors.onSurface }]}>{c}</Text></Pressable>))}
              </ScrollView>
            </View>
          </View>

          {type === "league" && (
            <>
              <Text style={styles.label}>MATCHES PER OPPONENT</Text>
              <View style={styles.row}>{[1, 2, 3, 4].map((n) => (<Pressable key={n} testID={`cc-mpo-${n}`} onPress={() => setMpo(n)} style={[styles.pill, mpo === n && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={[styles.pillText, mpo === n && { color: colors.onSurface }]}>{n}x</Text></Pressable>))}</View>
              <Text style={styles.label}>PLAYOFF QUALIFIERS</Text>
              <View style={styles.row}>{[0, 2, 4, 8, 16].map((n) => (<Pressable key={n} testID={`cc-po-${n}`} onPress={() => setPlayoff(n)} style={[styles.pill, playoff === n && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={[styles.pillText, playoff === n && { color: colors.onSurface }]}>{n === 0 ? "NONE" : `TOP ${n}`}</Text></Pressable>))}</View>
            </>
          )}

          <Text style={styles.label}>MAX PARTICIPANTS</Text>
          <View style={styles.row}>{[8, 16, 32, 64].map((n) => (<Pressable key={n} testID={`cc-max-${n}`} onPress={() => setMaxP(n)} style={[styles.pill, maxP === n && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={[styles.pillText, maxP === n && { color: colors.onSurface }]}>{n}</Text></Pressable>))}</View>

          {err && <Text style={styles.err} testID="cc-error">{err}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Pressable testID="cc-submit" onPress={create} disabled={busy} style={[styles.cta, { backgroundColor: accent }, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>CREATE COMPETITION →</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  label: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  pill: { height: 40, minWidth: 56, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  pillText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  curChip: { height: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
