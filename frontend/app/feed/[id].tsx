import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, timeAgo } from "@/src/theme";
import { api } from "@/src/api";
import { FeedCard } from "@/src/components/FeedCard";

export default function FeedDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.feedDetail(id as string);
      setPost(d.post);
      setComments(d.post.comments || []);
    } finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const r = await api.feedComment(id as string, t);
      setComments((prev) => [...prev, r.comment]);
      setText("");
    } catch { /* noop */ } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="feed-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="feed-back" style={{ padding: 4 }}><Ionicons name="arrow-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>POST</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={8}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {loading || !post ? <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} /> : (
            <>
              <FeedCard item={post} />
              <Text style={styles.commentsHead}>COMMENTS ({comments.length})</Text>
              {comments.length === 0 ? (
                <Text style={styles.empty}>Be the first to comment.</Text>
              ) : comments.map((c) => (
                <View key={c.id} style={styles.comment} testID={`comment-${c.id}`}>
                  <View style={styles.cavatar}><Text style={styles.cavatarText}>{(c.author_name || "A").charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cauthor}>{c.author_name} <Text style={styles.ctime}>· {timeAgo(c.created_at)}</Text></Text>
                    <Text style={styles.ctext}>{c.text}</Text>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
        <View style={styles.inputBar}>
          <TextInput
            testID="comment-input"
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            multiline
          />
          <Pressable testID="comment-send" onPress={send} disabled={busy || !text.trim()} style={[styles.sendBtn, (busy || !text.trim()) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={colors.onBrand} /> : <Ionicons name="send" size={18} color={colors.onBrand} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  title: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 26, color: colors.onSurface, letterSpacing: 2 },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  commentsHead: { ...font.textBold, letterSpacing: 2, fontSize: 11, color: colors.onSurfaceSecondary },
  empty: { ...font.text, fontSize: 13, color: colors.onSurfaceTertiary },
  comment: { flexDirection: "row", gap: spacing.sm },
  cavatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  cavatarText: { ...font.textBold, fontSize: 13, color: colors.onSurface },
  cauthor: { ...font.textBold, fontSize: 13, color: colors.onSurface },
  ctime: { ...font.text, fontSize: 11, color: colors.onSurfaceTertiary },
  ctext: { ...font.text, fontSize: 14, color: colors.onSurface, marginTop: 2 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary },
  input: { flex: 1, maxHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.onSurface, ...font.text, fontSize: 14, backgroundColor: colors.surface },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
