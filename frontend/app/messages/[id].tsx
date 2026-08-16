import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font } from "@/src/theme";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth-context";

export default function MessageThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { const d = await api.messagesThread(id as string); setData(d); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    const t = text.trim(); setText("");
    await api.messageSend(id as string, t);
    await load();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="message-thread-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="msg-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>{data?.other?.display_name || "Chat"}</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={8}>
        {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} /> : (
          <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
            {(data?.messages || []).length === 0 && <Text style={styles.empty}>Say hello 👋</Text>}
            {(data?.messages || []).map((m: any) => {
              const mine = m.from_user_id === user?.id;
              return (
                <View key={m.id} style={[styles.bubbleRow, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text style={[styles.bubbleText, mine && { color: "#0B0D12" }]}>{m.text}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
        <View style={styles.inputRow}>
          <TextInput testID="msg-input" value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} onSubmitEditing={send} />
          <Pressable testID="msg-send" onPress={send} style={styles.sendBtn}><Ionicons name="send" size={18} color="#0B0D12" /></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 24, color: colors.onSurface, letterSpacing: 1 },
  scroll: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  empty: { ...font.text, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.xl },
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "78%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...font.text, fontSize: 14, color: colors.onSurface },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, ...font.text, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
