import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";
import { COUNTRIES, citiesFor } from "@/src/data/geo";

type Props = {
  country: string | null;
  city: string | null;
  onChange: (v: { country: string | null; city: string | null }) => void;
  accent?: string;
};

export default function CountryCityPicker({ country, city, onChange, accent = colors.brand }: Props) {
  const [open, setOpen] = useState<null | "country" | "city">(null);
  const [q, setQ] = useState("");

  const options = useMemo(() => {
    if (open === "country") {
      return COUNTRIES.map((c) => c.name).filter((n) => n.toLowerCase().includes(q.toLowerCase()));
    }
    if (open === "city") {
      return citiesFor(country).filter((n) => n.toLowerCase().includes(q.toLowerCase()));
    }
    return [];
  }, [open, q, country]);

  const pick = (val: string) => {
    if (open === "country") onChange({ country: val, city: null });
    else onChange({ country, city: val });
    setOpen(null);
    setQ("");
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.label}>COUNTRY</Text>
          <Pressable testID="country-picker-btn" onPress={() => { setOpen("country"); setQ(""); }} style={styles.select}>
            <Text style={[styles.selectText, !country && styles.placeholder]} numberOfLines={1}>{country || "Select country"}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.label}>CITY</Text>
          <Pressable testID="city-picker-btn" onPress={() => { if (!country) return; setOpen("city"); setQ(""); }} style={[styles.select, !country && { opacity: 0.5 }]}>
            <Text style={[styles.selectText, !city && styles.placeholder]} numberOfLines={1}>{city || (country ? "Select city" : "Pick country first")}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>
      </View>

      <Modal visible={open !== null} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)} />
        <View style={styles.sheet} testID="geo-picker-sheet">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{open === "country" ? "SELECT COUNTRY" : "SELECT CITY"}</Text>
            <Pressable testID="geo-close" onPress={() => setOpen(null)} hitSlop={10}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <TextInput
            testID="geo-search"
            value={q}
            onChangeText={setQ}
            placeholder="Search…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.search}
            autoFocus
          />
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
            {options.length === 0 ? (
              <Text style={styles.empty}>No matches</Text>
            ) : options.map((o) => {
              const selected = (open === "country" ? country : city) === o;
              return (
                <Pressable key={o} testID={`geo-option-${o}`} onPress={() => pick(o)} style={[styles.optRow, selected && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={styles.optText}>{o}</Text>
                  {selected && <Ionicons name="checkmark" size={18} color={accent} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  label: { ...font.textBold, letterSpacing: 1.5, fontSize: 10, color: colors.onSurfaceSecondary },
  select: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSecondary },
  selectText: { ...font.textMedium, fontSize: 14, color: colors.onSurface, flex: 1 },
  placeholder: { color: colors.onSurfaceTertiary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderTopWidth: 1, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurface, letterSpacing: 1 },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: colors.onSurface, ...font.text, fontSize: 15, backgroundColor: colors.surface },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: 6 },
  optText: { ...font.textMedium, fontSize: 15, color: colors.onSurface },
  empty: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary, padding: spacing.md, textAlign: "center" },
});
