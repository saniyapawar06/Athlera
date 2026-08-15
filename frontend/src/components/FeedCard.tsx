import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, radius, font, sportAccent, timeAgo, REACTIONS, REACTION_ICON } from "@/src/theme";
import { api } from "@/src/api";

export type FeedItem = {
  id: string;
  kind: string;
  author_id?: string;
  author_name?: string;
  sport_id?: string;
  sport_name?: string;
  match_id?: string;
  winner_user_id?: string;
  loser_user_id?: string;
  winner_name?: string;
  loser_name?: string;
  score?: string;
  rating_delta?: number | null;
  tag?: string;
  text?: string;
  reaction_counts?: Record<string, number>;
  reaction_total?: number;
  my_reaction?: string | null;
  comment_count?: number;
  recent_comments?: { id: string; author_name: string; text: string }[];
  created_at?: string;
};

export function FeedCard({ item, onChanged }: { item: FeedItem; onChanged?: (it: FeedItem) => void }) {
  const router = useRouter();
  const accent = item.sport_id ? sportAccent(item.sport_id) : colors.brand;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [local, setLocal] = useState(item);

  const react = async (type: string) => {
    setPickerOpen(false);
    const next = local.my_reaction === type ? null : type;
    try {
      const r = await api.feedReact(local.id, next);
      const updated = { ...local, reaction_counts: r.reaction_counts, reaction_total: r.reaction_total, my_reaction: r.my_reaction };
      setLocal(updated);
      onChanged?.(updated);
    } catch { /* noop */ }
  };

  const topReactions = Object.entries(local.reaction_counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const isShared = local.kind === "shared_match";

  return (
    <View style={styles.card} testID={`feed-post-${local.id}`}>
      {/* header */}
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: accent + "22" }]}>
          <Text style={[styles.avatarText, { color: accent }]}>{(local.author_name || "A").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Pressable testID={`feed-author-${local.id}`} onPress={() => local.author_id && router.push(`/athlete/${local.author_id}`)}>
            <Text style={styles.author}>{local.author_name || "Athlete"}</Text>
          </Pressable>
          <Text style={styles.meta}>
            {isShared ? "shared a result" : "won a match"} · <Text style={{ color: accent }}>{local.sport_name}</Text> · {timeAgo(local.created_at)}
          </Text>
        </View>
        {local.tag ? <View style={[styles.tag, { borderColor: accent }]}><Text style={[styles.tagText, { color: accent }]}>{local.tag}</Text></View> : null}
      </View>

      {local.text ? <Text style={styles.body}>{local.text}</Text> : null}

      {/* result block */}
      <Pressable testID={`feed-match-${local.id}`} onPress={() => local.match_id && router.push(`/match/${local.match_id}`)} style={styles.result}>
        <View style={{ flex: 1 }}>
          <Text style={styles.resultLine}>
            <Text style={styles.winner}>{local.winner_name}</Text> def. {local.loser_name}
          </Text>
          {local.score ? <Text style={styles.score}>{local.score}</Text> : null}
        </View>
        {local.rating_delta != null ? (
          <View style={styles.deltaBox}>
            <Text style={styles.deltaLabel}>RATING</Text>
            <Text style={[styles.delta, { color: colors.success }]}>+{local.rating_delta}</Text>
          </View>
        ) : null}
      </Pressable>

      {/* reactions summary */}
      {(local.reaction_total || 0) > 0 && (
        <View style={styles.reactionSummary}>
          {topReactions.map(([t]) => (
            <Ionicons key={t} name={(REACTION_ICON[t] as any) || "heart"} size={13} color={colors.brandSecondary} />
          ))}
          <Text style={styles.reactionCount}>{local.reaction_total}</Text>
        </View>
      )}

      {/* reaction picker */}
      {pickerOpen && (
        <View style={styles.picker} testID={`reaction-picker-${local.id}`}>
          {REACTIONS.map((r) => (
            <Pressable key={r.type} testID={`react-${r.type}-${local.id}`} onPress={() => react(r.type)} style={[styles.pickerBtn, local.my_reaction === r.type && { backgroundColor: colors.surfaceTertiary }]}>
              <Ionicons name={r.icon as any} size={20} color={local.my_reaction === r.type ? colors.brand : colors.onSurface} />
            </Pressable>
          ))}
        </View>
      )}

      {/* actions */}
      <View style={styles.actions}>
        <Pressable testID={`like-btn-${local.id}`} onPress={() => local.my_reaction ? react(local.my_reaction) : setPickerOpen((v) => !v)} onLongPress={() => setPickerOpen(true)} style={styles.actionBtn}>
          <Ionicons name={local.my_reaction ? (REACTION_ICON[local.my_reaction] as any) : "heart-outline"} size={18} color={local.my_reaction ? colors.brand : colors.onSurfaceSecondary} />
          <Text style={[styles.actionText, local.my_reaction && { color: colors.brand }]}>{local.my_reaction ? "REACTED" : "REACT"}</Text>
        </Pressable>
        <Pressable testID={`comment-btn-${local.id}`} onPress={() => router.push(`/feed/${local.id}`)} style={styles.actionBtn}>
          <Ionicons name="chatbubble-outline" size={17} color={colors.onSurfaceSecondary} />
          <Text style={styles.actionText}>{local.comment_count ? `${local.comment_count} ` : ""}COMMENT</Text>
        </Pressable>
        <Pressable testID={`open-btn-${local.id}`} onPress={() => router.push(`/feed/${local.id}`)} style={styles.actionBtn}>
          <Ionicons name="open-outline" size={17} color={colors.onSurfaceSecondary} />
          <Text style={styles.actionText}>OPEN</Text>
        </Pressable>
      </View>

      {/* recent comments preview */}
      {(local.recent_comments || []).length > 0 && (
        <Pressable onPress={() => router.push(`/feed/${local.id}`)} style={styles.commentsPreview}>
          {(local.recent_comments || []).map((c) => (
            <Text key={c.id} style={styles.commentLine} numberOfLines={1}>
              <Text style={styles.commentAuthor}>{c.author_name}</Text> {c.text}
            </Text>
          ))}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 20 },
  author: { ...font.textBold, fontSize: 15, color: colors.onSurface },
  meta: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 1 },
  tag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tagText: { ...font.textBold, fontSize: 9, letterSpacing: 1 },
  body: { ...font.text, fontSize: 14, color: colors.onSurface },
  result: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  resultLine: { ...font.textMedium, fontSize: 14, color: colors.onSurface },
  winner: { ...font.textBold, color: colors.onSurface },
  score: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22, color: colors.onSurfaceSecondary, marginTop: 2, letterSpacing: 1 },
  deltaBox: { alignItems: "center" },
  deltaLabel: { ...font.textBold, fontSize: 8, letterSpacing: 1, color: colors.onSurfaceTertiary },
  delta: { ...font.display, fontFamily: "BarlowCondensed", fontSize: 22 },
  reactionSummary: { flexDirection: "row", alignItems: "center", gap: 3 },
  reactionCount: { ...font.textMedium, fontSize: 12, color: colors.onSurfaceSecondary, marginLeft: 2 },
  picker: { flexDirection: "row", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface, alignSelf: "flex-start" },
  pickerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  actionText: { ...font.textBold, fontSize: 10, letterSpacing: 1, color: colors.onSurfaceSecondary },
  commentsPreview: { gap: 2 },
  commentLine: { ...font.text, fontSize: 12, color: colors.onSurfaceSecondary },
  commentAuthor: { ...font.textBold, color: colors.onSurface },
});
