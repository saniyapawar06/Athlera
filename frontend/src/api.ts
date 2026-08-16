import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "athlera_access_token";

export const tokenStorage = {
  get: async (): Promise<string | null> =>
    Platform.OS === "web" ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY),
  set: async (v: string) =>
    Platform.OS === "web" ? AsyncStorage.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v),
  clear: async () =>
    Platform.OS === "web" ? AsyncStorage.removeItem(KEY) : SecureStore.deleteItemAsync(KEY),
};

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenStorage.get();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j.detail ?? detail;
    } catch { /* noop */ }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as any;
  return (await res.json()) as T;
}

export const api = {
  register: (email: string, password: string, display_name?: string) =>
    request<{ access_token: string; user: any }>("/auth/register", {
      method: "POST", body: JSON.stringify({ email, password, display_name }),
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: any }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    }),
  guest: () => request<{ access_token: string; user: any }>("/auth/guest", { method: "POST" }),
  me: () => request<any>("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),

  sports: () => request<{ sports: any[]; levels: any[] }>("/sports"),

  onboarding: (payload: {
    display_name?: string;
    submissions: Array<{
      sport_id: string;
      has_accredited: boolean;
      provider_name?: string;
      submitted_rating?: number;
      screenshot_base64?: string;
      level_id?: string;
    }>;
  }) => request<any>("/onboarding/submit", { method: "POST", body: JSON.stringify(payload) }),

  dashboard: () => request<any>("/me/dashboard"),
  sportPage: (id: string) => request<any>(`/sports/${id}`),
  rankingsSport: (id: string) => request<any>(`/rankings/sport/${id}`),
  rankingsUAS: () => request<any>(`/rankings/uas`),

  opponents: (sport_id: string, q: string) =>
    request<any>(`/opponents/search?sport_id=${sport_id}&q=${encodeURIComponent(q)}`),

  matchPreview: (payload: { sport_id: string; opponent_user_id: string; games: number[][] }) =>
    request<any>("/matches/preview", { method: "POST", body: JSON.stringify(payload) }),
  matchSubmit: (payload: { sport_id: string; opponent_user_id: string; games: number[][]; note?: string }) =>
    request<any>("/matches/submit", { method: "POST", body: JSON.stringify(payload) }),
  matchesMine: () => request<any>("/matches/mine"),

  events: () => request<any>("/events/upcoming"),
  feed: () => request<any>("/social/feed"),

  // --- gamification ---
  achievements: () => request<any>("/me/achievements"),
  shareToFeed: (payload: {
    kind: string; headline: string; subtext?: string; icon?: string;
    sport_id?: string; achievement_code?: string;
  }) => request<any>("/social/share", { method: "POST", body: JSON.stringify(payload) }),

  // --- sport extras ---
  ensureSport: (sport_id: string) =>
    request<any>(`/player-sports/ensure?sport_id=${sport_id}`, { method: "POST" }),
  scoringConfig: () => request<any>("/scoring/config"),
  ratingHistory: (sport_id: string) => request<any>(`/sports/${sport_id}/rating-history`),

  // --- live scoring ---
  liveCreate: (payload: any) => request<any>("/live/create", { method: "POST", body: JSON.stringify(payload) }),
  liveGet: (id: string) => request<any>(`/live/${id}`),
  liveEvent: (id: string, type: string, side?: number, note?: string) =>
    request<any>(`/live/${id}/event`, { method: "POST", body: JSON.stringify({ type, side, note }) }),
  liveFinalize: (id: string) => request<any>(`/live/${id}/finalize`, { method: "POST" }),
  liveAbandon: (id: string) => request<any>(`/live/${id}/abandon`, { method: "POST" }),
  liveMine: () => request<any>("/live/mine/active"),

  // --- competitions ---
  compCreate: (payload: any) => request<any>("/competitions/create", { method: "POST", body: JSON.stringify(payload) }),
  compList: (sport_id?: string) => request<any>(`/competitions/list${sport_id ? `?sport_id=${sport_id}` : ""}`),
  compMine: () => request<any>("/competitions/mine"),
  compDetail: (cid: string) => request<any>(`/competitions/${cid}`),
  compRegister: (cid: string) => request<any>(`/competitions/${cid}/register`, { method: "POST" }),
  compWithdraw: (cid: string) => request<any>(`/competitions/${cid}/withdraw`, { method: "POST" }),
  compGenerate: (cid: string) => request<any>(`/competitions/${cid}/generate-fixtures`, { method: "POST" }),
  fixtureManualResult: (fid: string, games: number[][]) =>
    request<any>(`/fixtures/${fid}/manual-result`, { method: "POST", body: JSON.stringify({ games }) }),

  // --- social ---
  ltpCreate: (payload: any) => request<any>("/ltp/create", { method: "POST", body: JSON.stringify(payload) }),
  ltpList: (sport_id?: string) => request<any>(`/ltp/list${sport_id ? `?sport_id=${sport_id}` : ""}`),
  nearby: (sport_id?: string) => request<any>(`/social/nearby${sport_id ? `?sport_id=${sport_id}` : ""}`),
  playRequestCreate: (payload: any) => request<any>("/play-requests/create", { method: "POST", body: JSON.stringify(payload) }),
  playRequestsMine: () => request<any>("/play-requests/mine"),
  playRequestAction: (request_id: string, action: string) =>
    request<any>("/play-requests/action", { method: "POST", body: JSON.stringify({ request_id, action }) }),
  messageSend: (to_user_id: string, text: string) =>
    request<any>("/messages/send", { method: "POST", body: JSON.stringify({ to_user_id, text }) }),
  messagesThread: (other_user_id: string) => request<any>(`/messages/${other_user_id}`),
  messageThreads: () => request<any>("/messages"),

  // --- history ---
  matchHistory: (params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request<any>(`/matches/history${qs ? `?${qs}` : ""}`);
  },
};

export { request };
