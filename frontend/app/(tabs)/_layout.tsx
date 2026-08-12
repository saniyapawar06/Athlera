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
          tabBarIcon: ({ color }) => (
            <View style={styles.scoreBtn}>
              <Ionicons name="add" size={26} color={colors.onBrand} />
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
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center", marginTop: -18,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
