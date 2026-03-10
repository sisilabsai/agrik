import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken } from "../lib/api";
import type { AuthRegisterPayload } from "../lib/api";

export type AuthUser = {
  id: string;
  phone: string;
  email: string;
  role: string;
  status?: string;
  verification_status?: string;
  created_at?: string;
};

type AuthActionResult = {
  status: string;
  message?: string;
  user?: AuthUser | null;
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (phone: string, password?: string | null) => Promise<AuthActionResult>;
  verify: (email: string, code: string) => Promise<void>;
  register: (payload: AuthRegisterPayload) => Promise<AuthActionResult>;
  resendVerificationCode: (email: string) => Promise<AuthActionResult>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
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
      return { status: "logged_in", user: result.user, message: result.message } satisfies AuthActionResult;
    }
    return { status: result.status, user: result.user ?? null, message: result.message } satisfies AuthActionResult;
  }, []);

  const register = useCallback(async (payload: AuthRegisterPayload) => {
    setError(null);
    const result = await api.authRegister(payload);
    if (result.token && result.user) {
      setToken(result.token);
      setUser(result.user);
      return { status: "logged_in", user: result.user, message: result.message } satisfies AuthActionResult;
    }
    return { status: result.status, user: result.user ?? null, message: result.message } satisfies AuthActionResult;
  }, []);

  const verify = useCallback(async (email: string, code: string) => {
    setError(null);
    const result = await api.authVerify({ email, code });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const resendVerificationCode = useCallback(async (email: string) => {
    setError(null);
    const result = await api.authResendVerificationCode({ email });
    return { status: result.status, user: result.user ?? null, message: result.message } satisfies AuthActionResult;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    setError(null);
    const result = await api.authRequestPasswordReset({ email });
    return { status: result.status, message: result.message } satisfies AuthActionResult;
  }, []);

  const resetPassword = useCallback(async (email: string, code: string, password: string) => {
    setError(null);
    const result = await api.authResetPassword({ email, code, password });
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, verify, register, resendVerificationCode, requestPasswordReset, resetPassword, logout }),
    [user, loading, error, login, verify, register, resendVerificationCode, requestPasswordReset, resetPassword, logout]
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
