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
};

export { request };
