import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken } from "../lib/api";
import type { AuthRegisterPayload } from "../lib/api";

export type AuthUser = {
  id: string;
  phone: string;
  role: string;
  status?: string;
  verification_status?: string;
  created_at?: string;
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (phone: string, password?: string | null) => Promise<"otp_sent" | "logged_in">;
  verify: (phone: string, code: string) => Promise<void>;
  register: (payload: AuthRegisterPayload) => Promise<"otp_sent" | "logged_in">;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    try {
      const me = await api.authMe();
      setUser(me);
    } catch (err) {
      const status = typeof err === "object" && err !== null ? (err as { status?: number }).status : undefined;
      if (status === 401) {
        setToken(null);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(async (phone: string, password?: string | null) => {
    setError(null);
    const result = await api.authLogin({ phone, password: password ?? undefined });
    if (result.token && result.user) {
      setToken(result.token);
      setUser(result.user);
      return "logged_in" as const;
    }
    return "otp_sent" as const;
  }, []);

  const register = useCallback(async (payload: AuthRegisterPayload) => {
    setError(null);
    const result = await api.authRegister(payload);
    if (result.token && result.user) {
      setToken(result.token);
      setUser(result.user);
      return "logged_in" as const;
    }
    return "otp_sent" as const;
  }, []);

  const verify = useCallback(async (phone: string, code: string) => {
    setError(null);
    const result = await api.authVerify({ phone, code });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, verify, register, logout }),
    [user, loading, error, login, verify, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
