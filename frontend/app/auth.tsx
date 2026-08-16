import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";

import { colors, spacing, radius, font } from "@/src/theme";
import { useAuth } from "@/src/auth-context";
import { ApiError } from "@/src/api";

type Mode = "signin" | "signup";

export default function AuthScreen() {
  const router = useRouter();
  const { login, register, guest, loading, user } = useAuth();
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      if (mode === "signup") {
        if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
        await register(email.trim(), password, displayName || undefined);
        router.replace("/onboarding/sports");
      } else {
        await login(email.trim(), password);
        // Route based on onboarded flag which is set on the user after login
        router.replace("/(tabs)");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong";
      setErr(msg);
    }
  };

  const continueAsGuest = async () => {
    setErr(null);
    try {
      await guest();
      router.replace("/onboarding/sports");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Guest mode failed");
    }
  };

  // After successful login, user.onboarded decides route (handled above for signup).
  React.useEffect(() => {
    if (user && mode === "signin") {
      router.replace(user.onboarded ? "/(tabs)" : "/onboarding/sports");
    }
  }, [user, mode, router]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="auth-screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInDown.duration(400)}>
            <Text style={styles.brand}>ATHLERA</Text>
            <View style={styles.bar} />
            <Text style={styles.tagline}>ERA OF THE ATHLETE</Text>
          </Animated.View>

          <View style={styles.tabs} testID="auth-mode-tabs">
            <Pressable
              testID="tab-signup"
              onPress={() => setMode("signup")}
              style={[styles.tab, mode === "signup" && styles.tabActive]}
            >
              <Text style={[styles.tabText, mode === "signup" && styles.tabTextActive]}>CREATE ACCOUNT</Text>
            </Pressable>
            <Pressable
              testID="tab-signin"
              onPress={() => setMode("signin")}
              style={[styles.tab, mode === "signin" && styles.tabActive]}
            >
              <Text style={[styles.tabText, mode === "signin" && styles.tabTextActive]}>SIGN IN</Text>
            </Pressable>
          </View>

          {mode === "signup" && (
            <View style={styles.field}>
              <Text style={styles.label}>DISPLAY NAME</Text>
              <TextInput
                testID="input-display-name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              testID="input-email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              testID="input-password"
              value={password}
              onChangeText={setPassword}
              placeholder="•••••••"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.input}
              secureTextEntry
            />
          </View>

          {err && <Text style={styles.error} testID="auth-error">{err}</Text>}

          <Pressable
            testID="auth-primary-submit"
            onPress={submit}
            disabled={loading}
            style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
          >
            {loading ? <ActivityIndicator color={colors.onBrand} /> : (
              <Text style={styles.primaryText}>{mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}</Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            testID="auth-continue-guest"
            onPress={continueAsGuest}
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.secondaryText}>CONTINUE AS GUEST</Text>
          </Pressable>

          <Text style={styles.guestNote}>
            Guests can explore ATHLERA and use demo functionality. Official ratings, verified results,
            messaging and competitions require an account.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  brand: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 56, color: colors.onSurface, letterSpacing: 4 },
  bar: { width: 40, height: 3, backgroundColor: colors.brand, marginTop: 4 },
  tagline: { ...font.textMedium, fontSize: 11, letterSpacing: 4, color: colors.onSurfaceSecondary, marginTop: spacing.sm, marginBottom: spacing.md },
  tabs: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  tab: { flex: 1, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  tabActive: { borderColor: colors.brand, backgroundColor: colors.surfaceTertiary },
  tabText: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary },
  tabTextActive: { color: colors.onSurface },
  field: { gap: 6 },
  label: { ...font.textBold, fontSize: 10, letterSpacing: 2, color: colors.onSurfaceSecondary },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radius.md, ...font.text, fontSize: 15,
  },
  error: { ...font.textMedium, color: colors.error, fontSize: 13 },
  primary: {
    backgroundColor: colors.brand, paddingVertical: spacing.md,
    alignItems: "center", borderRadius: radius.md, marginTop: spacing.sm,
  },
  primaryText: { ...font.textBold, color: colors.onBrand, letterSpacing: 2, fontSize: 13 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...font.textBold, letterSpacing: 3, fontSize: 11, color: colors.onSurfaceTertiary },
  secondary: {
    borderWidth: 1, borderColor: colors.borderStrong, paddingVertical: spacing.md,
    alignItems: "center", borderRadius: radius.md,
  },
  secondaryText: { ...font.textBold, color: colors.onSurface, letterSpacing: 2, fontSize: 13 },
  guestNote: { ...font.text, color: colors.onSurfaceTertiary, fontSize: 12, marginTop: spacing.sm, lineHeight: 18 },
});
