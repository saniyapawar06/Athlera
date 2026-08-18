import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { colors, radius } from "@/src/theme";

// Compact animated progress bar for milestones / competition progress.
export default function ProgressBar({ progress, color = colors.brand, height = 6 }: { progress: number; color?: string; height?: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [progress, w]);
  const style = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[styles.fill, style, { backgroundColor: color, borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: "100%", backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  fill: { height: "100%" },
});
