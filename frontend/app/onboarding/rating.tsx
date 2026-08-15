import React, { useEffect, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import { colors, spacing, radius, font, sportAccent, formatRating } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

type PerSport = {
  sport_id: string;
  has_accredited: boolean;
  provider_name?: string;
  submitted_rating?: string;
  screenshot_base64?: string;
  level_id?: string;
};

const RATING_PROVIDERS: Record<string, string[]> = {
  squash: ["World Squash Federation", "England Squash", "SquashLevels", "US Squash"],
  padel: ["FIP", "Playtomic", "MatchPadel"],
  tennis: ["UTR", "ITF", "USTA / NTRP", "LTA"],
  badminton: ["BWF", "Badminton England", "USAB"],
  pickleball: ["DUPR", "UTR-P", "USAP"],
};

export default function OnboardingRatingScreen() {
  const router = useRouter();
  const { sports: sportIdsParam } = useLocalSearchParams<{ sports: string }>();
  const { refresh } = useAuth();
  const [catalog, setCatalog] = useState<{ sports: any[]; levels: any[] } | null>(null);
  const [entries, setEntries] = useState<PerSport[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c = await api.sports();
      setCatalog(c);
      const ids = (sportIdsParam as string).split(",").filter(Boolean);
      setEntries(ids.map((id) => ({ sport_id: id, has_accredited: false, level_id: "intermediate" })));
    })();
  }, [sportIdsParam]);

  const updateEntry = (idx: number, patch: Partial<PerSport>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };

  const pickImage = async (idx: number) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr("Photo library permission required"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const b64 = a.base64 ? `data:image/jpeg;base64,${a.base64}` : undefined;
    updateEntry(idx, { screenshot_base64: b64 });
  };

  const submit = async () => {
    setErr(null);
    // validate
    for (const e of entries) {
      if (e.has_accredited) {
        if (!e.provider_name || !e.submitted_rating || isNaN(Number(e.submitted_rating))) {
          setErr(`Enter provider and numerical rating for ${e.sport_id}`);
          return;
        }
      } else if (!e.level_id) {
        setErr(`Pick a level for ${e.sport_id}`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        submissions: entries.map((e) => ({
          sport_id: e.sport_id,
          has_accredited: e.has_accredited,
          provider_name: e.has_accredited ? e.provider_name : undefined,
          submitted_rating: e.has_accredited ? Number(e.submitted_rating) : undefined,
          screenshot_base64: e.has_accredited ? e.screenshot_base64 : undefined,
          level_id: !e.has_accredited ? e.level_id : undefined,
        })),
      };
      const res = await api.onboarding(payload);
      await refresh();
      router.replace({ pathname: "/onboarding/summary", params: { ratings: JSON.stringify(res.ratings) } });
    } catch (e: any) {
      setErr(e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (!catalog || entries.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  const sportMeta = (id: string) => catalog.sports.find((s) => s.id === id)!;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-rating-screen">
      <View style={styles.header}>
        <Text style={styles.step}>STEP 2 OF 2</Text>
        <Text style={styles.title}>Set your starting rating</Text>
        <Text style={styles.subtitle}>Have an accredited rating? Upload proof and we&apos;ll use it. Otherwise pick your level.</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {entries.map((e, idx) => {
            const s = sportMeta(e.sport_id);
            const accent = sportAccent(e.sport_id);
            return (
              <View key={e.sport_id} style={styles.card} testID={`rating-card-${e.sport_id}`}>
                <View style={styles.cardHeader}>
                  <View style={[styles.sportPill, { borderColor: accent }]}>
                    <Text style={[styles.sportPillText, { color: accent }]}>{s.name.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <Pressable
                    testID={`accredited-yes-${e.sport_id}`}
                    onPress={() => updateEntry(idx, { has_accredited: true })}
                    style={[styles.switchBtn, e.has_accredited && styles.switchBtnActive]}
                  >
                    <Text style={[styles.switchText, e.has_accredited && styles.switchTextActive]}>I HAVE A RATING</Text>
                  </Pressable>
                  <Pressable
                    testID={`accredited-no-${e.sport_id}`}
                    onPress={() => updateEntry(idx, { has_accredited: false })}
                    style={[styles.switchBtn, !e.has_accredited && styles.switchBtnActive]}
                  >
                    <Text style={[styles.switchText, !e.has_accredited && styles.switchTextActive]}>PICK LEVEL</Text>
                  </Pressable>
                </View>

                {e.has_accredited ? (
                  <View style={{ gap: spacing.md }}>
                    <View>
                      <Text style={styles.label}>PROVIDER</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                        {RATING_PROVIDERS[e.sport_id]?.map((p) => (
                          <Pressable
                            key={p}
                            testID={`provider-${e.sport_id}-${p.replace(/\s/g, "-")}`}
                            onPress={() => updateEntry(idx, { provider_name: p })}
                            style={[styles.chip, e.provider_name === p && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}
                          >
                            <Text style={[styles.chipText, e.provider_name === p && { color: accent }]}>{p}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                    <View>
                      <Text style={styles.label}>RATING VALUE</Text>
                      <TextInput
                        testID={`rating-value-${e.sport_id}`}
                        value={e.submitted_rating || ""}
                        onChangeText={(v) => updateEntry(idx, { submitted_rating: v })}
                        placeholder={s.decimals > 0 ? "e.g. 4.25" : "e.g. 8500"}
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.input}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Pressable
                      testID={`upload-screenshot-${e.sport_id}`}
                      onPress={() => pickImage(idx)}
                      style={styles.uploadBtn}
                    >
                      <Text style={styles.uploadBtnText}>
                        {e.screenshot_base64 ? "✓ SCREENSHOT ATTACHED · REPLACE" : "UPLOAD SCREENSHOT (verification)"}
                      </Text>
                    </Pressable>
                    <Text style={styles.hint}>Screenshot is stored privately as verification evidence. Rating starts as “Verification Pending”.</Text>
                  </View>
                ) : (
                  <View style={{ gap: spacing.sm }}>
                    <Text style={styles.label}>APPROXIMATE PLAYING LEVEL</Text>
                    <View style={{ gap: spacing.xs }}>
                      {catalog.levels.map((lvl: any) => (
                        <Pressable
                          key={lvl.id}
                          testID={`level-${e.sport_id}-${lvl.id}`}
                          onPress={() => updateEntry(idx, { level_id: lvl.id })}
                          style={[styles.levelRow, e.level_id === lvl.id && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.levelName, e.level_id === lvl.id && { color: accent }]}>{lvl.label}</Text>
                            <Text style={styles.levelBlurb}>{lvl.blurb}</Text>
                          </View>
                          <View style={[styles.radio, e.level_id === lvl.id && { borderColor: accent }]}>
                            {e.level_id === lvl.id && <View style={[styles.radioDot, { backgroundColor: accent }]} />}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {err && <Text style={styles.error} testID="onboarding-rating-error">{err}</Text>}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            testID="onboarding-submit-btn"
            onPress={submit}
            disabled={submitting}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, submitting && { opacity: 0.6 }]}
          >
            {submitting ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.ctaText}>GENERATE PROVISIONAL RATINGS →</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: 6 },
  step: { ...font.textBold, fontSize: 10, letterSpacing: 3, color: colors.brand },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 30, color: colors.onSurface },
  subtitle: { ...font.text, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 19 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, backgroundColor: colors.surfaceSecondary },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sportPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1, borderRadius: radius.pill },
  sportPillText: { ...font.textBold, letterSpacing: 3, fontSize: 11 },
  switchRow: { flexDirection: "row", gap: spacing.sm },
  switchBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, alignItems: "center", borderRadius: radius.md },
  switchBtnActive: { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary },
  switchText: { ...font.textBold, letterSpacing: 2, fontSize: 10, color: colors.onSurfaceSecondary },
  switchTextActive: { color: colors.onSurface },
  label: { ...font.textBold, fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  chipRow: { gap: spacing.sm, paddingRight: spacing.md },
  chip: { flexShrink: 0, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, backgroundColor: colors.surface, justifyContent: "center" },
  chipText: { ...font.textMedium, fontSize: 12, color: colors.onSurfaceSecondary },
  uploadBtn: { borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed", padding: spacing.md, alignItems: "center", borderRadius: radius.md },
  uploadBtnText: { ...font.textBold, letterSpacing: 1, fontSize: 12, color: colors.onSurface },
  hint: { ...font.text, fontSize: 12, color: colors.onSurfaceTertiary, lineHeight: 17 },
  levelRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  levelName: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  levelBlurb: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  error: { ...font.textMedium, color: colors.error, fontSize: 13, marginTop: spacing.sm },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md, backgroundColor: colors.surface },
  cta: { backgroundColor: colors.brand, paddingVertical: spacing.md, alignItems: "center", borderRadius: radius.md },
  ctaText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
});
