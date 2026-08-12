import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, tokenStorage } from "./api";

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

  useEffect(() => {
    (async () => {
      await refresh();
      setReady(true);
    })();
  }, [refresh]);

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

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* noop */ }
    await tokenStorage.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, ready, loading, refresh, login, register, guest, logout, setUser,
  }), [user, ready, loading, refresh, login, register, guest, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
