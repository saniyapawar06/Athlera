import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, sportAccent } from "@/src/theme";
import { api } from "@/src/api";

export default function LTPCreateScreen() {
  const router = useRouter();
  const [sports, setSports] = useState<any[]>([]);
  const [sportId, setSportId] = useState<string>("");
  const [when, setWhen] = useState("");
  const [area, setArea] = useState("");
  const [radius_km, setRadius] = useState(10);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { (async () => { const s = await api.sports(); setSports(s.sports); setSportId(s.sports[0].id); })(); }, []);

  const submit = async () => {
    setErr(null);
    if (!when.trim() || !area.trim()) { setErr("When and area are required"); return; }
    setBusy(true);
    try { await api.ltpCreate({ sport_id: sportId, when_text: when.trim(), area: area.trim(), radius_km, message: message.trim() || null }); router.back(); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };

  const accent = sportAccent(sportId);
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="ltp-create-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="ltp-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>LOOKING TO PLAY</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>SPORT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}>
            {sports.map((s) => (<Pressable key={s.id} testID={`ltp-sport-${s.id}`} onPress={() => setSportId(s.id)} style={[styles.chip, sportId === s.id && { borderColor: sportAccent(s.id), backgroundColor: colors.surfaceTertiary }]}><Text style={[styles.chipText, sportId === s.id && { color: sportAccent(s.id) }]}>{s.name.toUpperCase()}</Text></Pressable>))}
          </ScrollView>
          <Text style={styles.label}>WHEN</Text>
          <TextInput testID="ltp-when" value={when} onChangeText={setWhen} placeholder="e.g. Saturday morning" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <Text style={styles.label}>AREA / GENERAL LOCATION</Text>
          <TextInput testID="ltp-area" value={area} onChangeText={setArea} placeholder="e.g. Central London" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
          <Text style={styles.label}>RADIUS</Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>{[5, 10, 20, 40].map((r) => (<Pressable key={r} testID={`ltp-radius-${r}`} onPress={() => setRadius(r)} style={[styles.chip, radius_km === r && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}><Text style={[styles.chipText, radius_km === r && { color: colors.onSurface }]}>{r}km</Text></Pressable>))}</View>
          <Text style={styles.label}>MESSAGE (optional)</Text>
          <TextInput testID="ltp-message" value={message} onChangeText={setMessage} placeholder="Add a note…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, { height: 90, textAlignVertical: "top" }]} multiline />
          {err && <Text style={styles.err} testID="ltp-error">{err}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={styles.footer}>
        <Pressable testID="ltp-submit" onPress={submit} disabled={busy} style={[styles.cta, { backgroundColor: accent }, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#0B0D12" /> : <Text style={styles.ctaText}>POST →</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg },
  label: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  chip: { height: 40, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  chipText: { ...font.textBold, letterSpacing: 1, fontSize: 11, color: colors.onSurfaceSecondary },
  err: { ...font.textMedium, color: colors.error, fontSize: 13 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  cta: { paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, letterSpacing: 2, fontSize: 13, color: "#0B0D12" },
});
