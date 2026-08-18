import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Modal, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";

// Reusable Date + Time picker. Uses native pickers on iOS/Android and a safe
// text fallback on web (so the web preview never crashes). `value` is a Date | null.
type Props = {
  value: Date | null;
  onChange: (d: Date | null) => void;
  accent?: string;
  allowClear?: boolean;
  testIDPrefix?: string;
};

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function DateTimeField({ value, onChange, accent = colors.brand, allowClear = true, testIDPrefix = "dt" }: Props) {
  const [iosMode, setIosMode] = useState<null | "date" | "time">(null);

  const openAndroid = async (mode: "date" | "time") => {
    const { DateTimePickerAndroid } = await import("@react-native-community/datetimepicker");
    DateTimePickerAndroid.open({
      value: value || new Date(),
      mode,
      is24Hour: false,
      onChange: (_e: any, selected?: Date) => {
        if (!selected) return;
        const base = value || new Date();
        const next = new Date(base);
        if (mode === "date") {
          next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        } else {
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        }
        onChange(next);
      },
    });
  };

  const press = (mode: "date" | "time") => {
    if (Platform.OS === "android") openAndroid(mode);
    else setIosMode(mode);
  };

  // ---- Web fallback: plain text fields ----
  if (Platform.OS === "web") {
    const dateStr = value ? value.toISOString().slice(0, 10) : "";
    const timeStr = value ? value.toTimeString().slice(0, 5) : "";
    const apply = (d: string, t: string) => {
      if (!d) { onChange(null); return; }
      const parsed = new Date(`${d}T${(t || "12:00")}:00`);
      if (!isNaN(parsed.getTime())) onChange(parsed);
    };
    return (
      <View style={styles.row}>
        <TextInput testID={`${testIDPrefix}-date-web`} value={dateStr} onChangeText={(v) => apply(v, timeStr)} placeholder="YYYY-MM-DD" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.field, { flex: 1.4 }]} />
        <TextInput testID={`${testIDPrefix}-time-web`} value={timeStr} onChangeText={(v) => apply(dateStr, v)} placeholder="HH:MM" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.field, { flex: 1 }]} />
        {allowClear && value && (
          <Pressable testID={`${testIDPrefix}-clear`} onPress={() => onChange(null)} style={styles.clearBtn}><Ionicons name="close" size={16} color={colors.onSurfaceSecondary} /></Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable testID={`${testIDPrefix}-date`} onPress={() => press("date")} style={[styles.field, { flex: 1.4 }]}>
        <Ionicons name="calendar-outline" size={16} color={accent} />
        <Text style={[styles.fieldText, !value && styles.placeholder]} numberOfLines={1}>{value ? fmtDate(value) : "Pick date"}</Text>
      </Pressable>
      <Pressable testID={`${testIDPrefix}-time`} onPress={() => press("time")} style={[styles.field, { flex: 1 }]}>
        <Ionicons name="time-outline" size={16} color={accent} />
        <Text style={[styles.fieldText, !value && styles.placeholder]} numberOfLines={1}>{value ? fmtTime(value) : "Time"}</Text>
      </Pressable>
      {allowClear && value && (
        <Pressable testID={`${testIDPrefix}-clear`} onPress={() => onChange(null)} style={styles.clearBtn}><Ionicons name="close" size={16} color={colors.onSurfaceSecondary} /></Pressable>
      )}

      {Platform.OS === "ios" && iosMode && (
        <IosPicker mode={iosMode} value={value || new Date()} accent={accent} onClose={() => setIosMode(null)} onConfirm={(d) => { onChange(d); setIosMode(null); }} />
      )}
    </View>
  );
}

function IosPicker({ mode, value, onConfirm, onClose, accent }: { mode: "date" | "time"; value: Date; onConfirm: (d: Date) => void; onClose: () => void; accent: string }) {
  const [temp, setTemp] = useState<Date>(value);
  const DateTimePicker = require("@react-native-community/datetimepicker").default;
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.iosSheet}>
        <View style={styles.iosHead}>
          <Pressable testID="dt-ios-cancel" onPress={onClose}><Text style={styles.iosCancel}>Cancel</Text></Pressable>
          <Pressable testID="dt-ios-done" onPress={() => onConfirm(temp)}><Text style={[styles.iosDone, { color: accent }]}>Done</Text></Pressable>
        </View>
        <DateTimePicker
          value={temp}
          mode={mode}
          display="spinner"
          themeVariant="dark"
          onChange={(_e: any, d?: Date) => { if (d) setTemp(d); }}
          style={{ backgroundColor: colors.surfaceSecondary }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  field: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSecondary },
  fieldText: { ...font.textMedium, fontSize: 13, color: colors.onSurface, flex: 1 },
  placeholder: { color: colors.onSurfaceTertiary },
  clearBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  iosSheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  iosHead: { flexDirection: "row", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  iosCancel: { ...font.textMedium, fontSize: 15, color: colors.onSurfaceSecondary },
  iosDone: { ...font.textBold, fontSize: 15 },
});
