import React from "react";
import { Tabs } from "expo-router";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, spacing } from "@/src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 84 : 68,
          paddingBottom: Platform.OS === "ios" ? 24 : 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.onSurfaceTertiary,
        tabBarLabelStyle: { ...font.textBold, letterSpacing: 1, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "SPORTS",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "trophy" : "trophy-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="compete"
        options={{
          title: "COMPETE",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "flame" : "flame-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="score"
        options={{
          title: "SCORE",
          tabBarIcon: () => (
            <View style={styles.scoreBtn}>
              <Ionicons name="tennisball" size={20} color={colors.onBrand} />
              <Text style={styles.scoreBtnText}>SCORE</Text>
            </View>
          ),
          tabBarLabel: () => null,
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: "SOCIAL",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: "RANKINGS",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "podium" : "podium-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scoreBtn: {
    width: 58, height: 58, borderRadius: 20, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center", marginTop: -22, gap: 1,
    shadowColor: colors.brand, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
    borderWidth: 2, borderColor: colors.surfaceSecondary,
  },
  scoreBtnText: { ...font.textBold, fontSize: 8, letterSpacing: 1, color: colors.onBrand },
});
