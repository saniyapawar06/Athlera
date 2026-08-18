import React from "react";
import { Pressable, PressableProps } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  scaleTo?: number;
  haptic?: boolean;
  children: React.ReactNode;
};

// Lightweight tactile press feedback used across interactive surfaces.
export default function PressableScale({ scaleTo = 0.96, haptic = false, style, onPressIn, onPressOut, children, ...rest }: Props) {
  const s = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { s.value = withTiming(scaleTo, { duration: 90 }); if (haptic) { try { Haptics.selectionAsync(); } catch {} } onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withTiming(1, { duration: 120 }); onPressOut?.(e); }}
      style={[aStyle, style as any]}
    >
      {children}
    </AnimatedPressable>
  );
}
