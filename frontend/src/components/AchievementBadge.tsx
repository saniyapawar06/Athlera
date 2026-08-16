import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { tierColor, Achievement } from "@/src/gamification";

export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const locked = !achievement.unlocked;
  const tc = tierColor(achievement.tier);
  return (
    <View
      testID={`achievement-${achievement.code}`}
      style={[styles.wrap, { borderColor: locked ? colors.border : tc + "88" }, locked && styles.locked]}
    >
      <View style={[styles.iconCircle, { borderColor: locked ? colors.borderStrong : tc }]}>
        <Ionicons name={(locked ? "lock-closed" : achievement.icon) as any} size={20} color={locked ? colors.onSurfaceTertiary : tc} />
      </View>
      <Text numberOfLines={1} style={[styles.title, locked && { color: colors.onSurfaceTertiary }]}>{achievement.title}</Text>
      <Text numberOfLines={2} style={styles.desc}>{achievement.unlocked && achievement.detail ? achievement.detail : achievement.desc}</Text>
      {!locked && (
        <View style={[styles.tierPill, { borderColor: tc }]}>
          <Text style={[styles.tierText, { color: tc }]}>{(achievement.tier || "").toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "31%", minWidth: 100, flexGrow: 1, alignItems: "center", gap: 5, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  locked: { backgroundColor: colors.surface, opacity: 0.65 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  title: { ...font.textBold, fontSize: 11, color: colors.onSurface, textAlign: "center", letterSpacing: 0.3 },
  desc: { ...font.text, fontSize: 9, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 12 },
  tierPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  tierText: { ...font.textBold, letterSpacing: 1, fontSize: 7 },
});
