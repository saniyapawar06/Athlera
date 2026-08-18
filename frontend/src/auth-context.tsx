import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, tokenStorage } from "./api";
import { cacheClear } from "./utils/cache";

WebBrowser.maybeCompleteAuthSession();

const EMERGENT_AUTH = "https://auth.emergentagent.com/";
const sentSessionIds = new Set<string>();

function extractSessionId(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export type AuthUser = {
  id: string;
  email: string | null;
  is_guest: boolean;
  display_name?: string | null;
  username?: string | null;
  onboarded?: boolean;
  city?: string | null;
} | null;

type AuthContextValue = {
  user: AuthUser;
  ready: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  guest: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const token = await tokenStorage.get();
      if (!token) { setUser(null); return; }
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
      await tokenStorage.clear();
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.login(email, password);
      await tokenStorage.set(res.access_token);
      setUser(res.user);
    } finally { setLoading(false); }
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    setLoading(true);
    try {
      const res = await api.register(email, password, name);
      await tokenStorage.set(res.access_token);
      setUser(res.user);
    } finally { setLoading(false); }
  }, []);

  const guest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.guest();
      await tokenStorage.set(res.access_token);
      setUser(res.user);
    } finally { setLoading(false); }
  }, []);

  const processSessionId = useCallback(async (sid: string) => {
    if (!sid || sentSessionIds.has(sid)) return;
    sentSessionIds.add(sid);
    const res = await api.authSession(sid);
    await tokenStorage.set(res.access_token);
    setUser(res.user);
  }, []);

  useEffect(() => {
    (async () => {
      // Web: if we came back from Google with a session_id, exchange it first.
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
        if (sid) {
          try {
            await processSessionId(sid);
            // strip only the session_id, preserve the rest
            try {
              const url = new URL(window.location.href);
              url.hash = "";
              url.searchParams.delete("session_id");
              window.history.replaceState(window.history.state, "", url.toString());
            } catch { /* noop */ }
            setReady(true);
            return;
          } catch { /* fall through to normal refresh */ }
        }
      }
      await refresh();
      setReady(true);
    })();
  }, [refresh, processSessionId]);

  // Mobile: handle cold-start and hot deep links carrying a session_id.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Linking.addEventListener("url", (e) => {
      const sid = extractSessionId(e.url);
      if (sid) processSessionId(sid).catch(() => {});
    });
    (async () => {
      const initial = await Linking.getInitialURL();
      const sid = extractSessionId(initial);
      if (sid) processSessionId(sid).catch(() => {});
    })();
    return () => sub.remove();
  }, [processSessionId]);

  const loginWithGoogle = useCallback(async () => {
    setLoading(true);
    try {
      if (Platform.OS === "web") {
        const redirectUrl = window.location.origin + "/";
        window.location.href = `${EMERGENT_AUTH}?redirect=${encodeURIComponent(redirectUrl)}`;
        return; // browser navigates away
      }
      const redirectUrl = Linking.createURL("");
      const authUrl = `${EMERGENT_AUTH}?redirect=${encodeURIComponent(redirectUrl)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let sid = result.type === "success" ? extractSessionId(result.url) : null;
      if (!sid) sid = extractSessionId(await Linking.getInitialURL());
      if (sid) await processSessionId(sid);
    } finally { setLoading(false); }
  }, [processSessionId]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* noop */ }
    await tokenStorage.clear();
    cacheClear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, ready, loading, refresh, login, register, guest, loginWithGoogle, logout, setUser,
  }), [user, ready, loading, refresh, login, register, guest, loginWithGoogle, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
