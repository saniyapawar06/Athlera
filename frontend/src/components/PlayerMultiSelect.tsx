import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";
import { api } from "@/src/api";

export type SelectablePlayer = { user_id: string; display_name: string; rating?: number; city?: string };

type Props = {
  sportId: string;
  accent: string;
  selected: SelectablePlayer[];
  onChange: (players: SelectablePlayer[]) => void;
  reorderable?: boolean; // seed order matters (knockout manual draw)
  excludeUserIds?: string[];
};

export default function PlayerMultiSelect({ sportId, accent, selected, onChange, reorderable, excludeUserIds = [] }: Props) {
  const [source, setSource] = useState<"search" | "nearby">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SelectablePlayer[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.user_id)), [selected]);
  const excluded = useMemo(() => new Set(excludeUserIds), [excludeUserIds]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        if (source === "search") {
          const r = await api.opponents(sportId, q);
          if (alive) setResults(r.opponents || []);
        } else {
          const r = await api.nearby(sportId);
          if (alive) setResults((r.players || r.nearby || []).map((p: any) => ({ user_id: p.user_id, display_name: p.display_name, rating: p.rating, city: p.area || p.city })));
        }
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, source === "search" ? 200 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, source, sportId]);

  const toggle = (p: SelectablePlayer) => {
    if (selectedIds.has(p.user_id)) onChange(selected.filter((s) => s.user_id !== p.user_id));
    else onChange([...selected, p]);
  };
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...selected];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const visible = results.filter((r) => !excluded.has(r.user_id));

  return (
    <View style={{ gap: spacing.sm }}>
      {/* selected chips */}
      {selected.length > 0 && (
        <View style={styles.chipWrap} testID="pms-selected">
          {selected.map((s, i) => (
            <View key={s.user_id} style={[styles.chip, { borderColor: accent }]} testID={`pms-chip-${s.user_id}`}>
              {reorderable && <Text style={[styles.seed, { color: accent }]}>{i + 1}</Text>}
              <Text style={styles.chipText} numberOfLines={1}>{s.display_name}</Text>
              {reorderable && (
                <>
                  <Pressable testID={`pms-up-${s.user_id}`} onPress={() => move(i, -1)} hitSlop={8} style={styles.chipIcon}><Ionicons name="chevron-up" size={14} color={colors.onSurfaceSecondary} /></Pressable>
                  <Pressable testID={`pms-down-${s.user_id}`} onPress={() => move(i, 1)} hitSlop={8} style={styles.chipIcon}><Ionicons name="chevron-down" size={14} color={colors.onSurfaceSecondary} /></Pressable>
                </>
              )}
              <Pressable testID={`pms-remove-${s.user_id}`} onPress={() => toggle(s)} hitSlop={8} style={styles.chipIcon}><Ionicons name="close" size={14} color={colors.onSurfaceSecondary} /></Pressable>
            </View>
          ))}
        </View>
      )}

      {/* source toggle */}
      <View style={styles.segment}>
        {(["search", "nearby"] as const).map((s) => (
          <Pressable key={s} testID={`pms-source-${s}`} onPress={() => setSource(s)} style={[styles.segBtn, source === s && { backgroundColor: colors.surfaceTertiary, borderColor: accent }]}>
            <Ionicons name={s === "search" ? "search" : "location"} size={13} color={source === s ? colors.onSurface : colors.onSurfaceTertiary} />
            <Text style={[styles.segText, source === s && { color: colors.onSurface }]}>{s === "search" ? "SEARCH" : "NEARBY"}</Text>
          </Pressable>
        ))}
      </View>

      {source === "search" && (
        <TextInput testID="pms-search" value={q} onChangeText={setQ} placeholder="Search athletes by name…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
      )}

      {loading ? <ActivityIndicator color={accent} style={{ marginVertical: spacing.md }} /> : (
        visible.length === 0 ? (
          <Text style={styles.hint}>{source === "nearby" ? "No nearby players yet." : "No athletes found."}</Text>
        ) : (
          visible.slice(0, 8).map((p) => {
            const on = selectedIds.has(p.user_id);
            return (
              <Pressable key={p.user_id} testID={`pms-result-${p.user_id}`} onPress={() => toggle(p)} style={[styles.row, on && { borderColor: accent, backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name={on ? "checkmark-circle" : "add-circle-outline"} size={20} color={on ? accent : colors.onSurfaceTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{p.display_name}</Text>
                  {!!p.city && <Text style={styles.meta}>{p.city}</Text>}
                </View>
                {p.rating != null && <Text style={styles.rating}>{typeof p.rating === "number" ? (Number.isInteger(p.rating) ? p.rating : p.rating.toFixed(2)) : p.rating}</Text>}
              </Pressable>
            );
          })
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: spacing.sm, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, maxWidth: 200 },
  seed: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 15, minWidth: 14, textAlign: "center" },
  chipText: { ...font.textBold, fontSize: 12, color: colors.onSurface, flexShrink: 1 },
  chipIcon: { padding: 2 },
  segment: { flexDirection: "row", gap: spacing.sm },
  segBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  segText: { ...font.textBold, letterSpacing: 1, fontSize: 10, color: colors.onSurfaceTertiary },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.md, ...font.text, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  name: { ...font.textBold, fontSize: 14, color: colors.onSurface },
  meta: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 1 },
  rating: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20, color: colors.onSurfaceSecondary },
  hint: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary, paddingVertical: spacing.sm },
});
