import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";
import { tierColor, Achievement } from "@/src/gamification";

type Props = {
  achievement: Achievement;
  locked?: boolean;
  compact?: boolean;
};

export function AchievementBadge({ achievement, locked = false, compact = false }: Props) {
  const tc = tierColor(achievement.tier);
  const size = compact ? 40 : 52;
  return (
    <View
      testID={`achievement-${achievement.code}`}
      style={[
        styles.wrap,
        compact && styles.wrapCompact,
        { borderColor: locked ? colors.border : tc + "88" },
        locked && styles.locked,
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          { width: size, height: size, borderRadius: size / 2, borderColor: locked ? colors.borderStrong : tc },
        ]}
      >
        <Ionicons
          name={(locked ? "lock-closed" : achievement.icon) as any}
          size={compact ? 18 : 22}
          color={locked ? colors.onSurfaceTertiary : tc}
        />
      </View>
      <Text numberOfLines={1} style={[styles.title, locked && { color: colors.onSurfaceTertiary }]}>
        {achievement.title}
      </Text>
      {!compact && (
        <Text numberOfLines={2} style={styles.desc}>
          {achievement.sport_name ? `${achievement.sport_name} · ` : ""}
          {achievement.desc}
        </Text>
      )}
      {!locked && (
        <View style={[styles.tierPill, { borderColor: tc }]}>
          <Text style={[styles.tierText, { color: tc }]}>{(achievement.tier || "").toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "31%",
    minWidth: 100,
    flexGrow: 1,
    alignItems: "center",
    gap: 6,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  wrapCompact: { width: 96, minWidth: 96, padding: spacing.sm },
  locked: { backgroundColor: colors.surface, opacity: 0.7 },
  iconCircle: { borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  title: { ...font.textBold, fontSize: 11, color: colors.onSurface, textAlign: "center", letterSpacing: 0.3 },
  desc: { ...font.text, fontSize: 9, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 12 },
  tierPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  tierText: { ...font.textBold, letterSpacing: 1, fontSize: 7 },
});
