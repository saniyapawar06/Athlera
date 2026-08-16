import { colors } from "@/src/theme";

export type Achievement = {
  code: string;
  title: string;
  desc?: string;
  tier: string;
  icon: string;
  category?: string;
  unlocked?: boolean;
  detail?: string;
};

export type CelebLevel = "small" | "milestone" | "trophy";
export type ShareBody = { kind: string; headline: string; subtext?: string; icon?: string; sport_id?: string };

export const TIER_COLORS: Record<string, string> = {
  bronze: "#CD7F32",
  silver: "#B8C0CC",
  gold: "#FFD166",
  platinum: "#7FE7E0",
  diamond: "#8FD3FF",
};
export const tierColor = (t?: string): string => TIER_COLORS[(t || "bronze").toLowerCase()] || colors.brand;

export const TONE_COLORS: Record<string, string> = {
  info: colors.onSurfaceSecondary,
  hot: "#FB923C",
  pb: colors.success,
  up: colors.success,
  warn: colors.warning,
  comp: colors.brandSecondary,
};
export const toneColor = (t?: string): string => TONE_COLORS[t || "info"] || colors.onSurfaceSecondary;

export const CATEGORY_LABELS: Record<string, string> = {
  rank: "Ranking",
  streak: "Streaks",
  competition: "Competitions",
  milestone: "Milestones",
  multi: "Multi-Sport",
};
export const CATEGORY_ORDER = ["rank", "streak", "competition", "milestone", "multi"];

/** Celebration intensity from a rating_change record + context. */
export function celebrationLevel(rc: any, isCompetition = false): CelebLevel {
  if (!rc) return "small";
  if (isCompetition && rc.is_winner) return "trophy";
  if (rc.new_peak || rc.level_up || (rc.is_winner && rc.streak >= 3)) return "milestone";
  return "small";
}

export function resultHeadline(rc: any, won: boolean, isCompetition = false): string {
  if (isCompetition && won) return "COMPETITION WIN";
  if (rc?.level_up) return "RATING ESTABLISHED";
  if (rc?.new_peak) return "NEW PERSONAL BEST";
  if (won && rc?.streak >= 3) return `${rc.streak} MATCH STREAK`;
  if (won) return "VICTORY SECURED";
  return "KEEP GOING";
}

/** Encouraging subline — even in defeat. */
export function resultSubMessage(rc: any, won: boolean, form: string[] = []): string | null {
  if (won) return rc?.delta != null ? `+${rc.delta} rating gained` : null;
  const last5 = (form || []).slice(-5);
  const wins = last5.filter((f) => f === "W").length;
  if (wins > 0) return `${wins} wins from your last ${last5.length} — momentum is building`;
  return "Every match sharpens your game. Reset and go again.";
}

/** Build a Social Feed share payload from a completed result, or null. */
export function shareFromResult(rc: any, sport: { id: string; name: string }, won: boolean, isCompetition = false): ShareBody | null {
  if (isCompetition && won) return { kind: "competition", headline: `Won a ${sport.name} competition match`, icon: "trophy", sport_id: sport.id };
  if (rc?.new_peak) return { kind: "pb", headline: `New personal best in ${sport.name}`, subtext: `Rating ${rc.after}`, icon: "trending-up", sport_id: sport.id };
  if (won && rc?.streak >= 3) return { kind: "streak", headline: `${rc.streak} match win streak in ${sport.name}`, icon: "flame", sport_id: sport.id };
  if (won) return { kind: "win", headline: `Won a ${sport.name} match`, subtext: rc?.delta != null ? `+${rc.delta} rating` : undefined, icon: "trophy", sport_id: sport.id };
  return null;
}
