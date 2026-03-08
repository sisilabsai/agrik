import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAdminToken, type ApiError } from "../lib/api";

export type AdminUser = {
  id: string;
  email: string;
  status: string;
  verification_status: string;
  created_at: string;
};

type AdminAuthState = {
  admin: AdminUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<"logged_in" | "otp_sent">;
  verify: (email: string, code: string) => Promise<void>;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthState | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    try {
      const me = await api.adminMe();
      setAdmin(me as AdminUser);
    } catch {
      setAdminToken(null);
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await api.adminLogin({ email, password });
      if (result.token && result.admin) {
        setAdminToken(result.token);
        setAdmin(result.admin as AdminUser);
        return "logged_in" as const;
      }
      return "otp_sent" as const;
    } catch (err) {
      const detail = (err as ApiError | undefined)?.detail;
      setError(detail || "Unable to authenticate admin.");
      throw new Error("admin login failed");
    }
  }, []);

  const verify = useCallback(async (email: string, code: string) => {
    setError(null);
    try {
      const result = await api.adminVerify({ email, code });
      setAdminToken(result.token);
      setAdmin(result.admin as AdminUser);
    } catch (err) {
      const detail = (err as ApiError | undefined)?.detail;
      setError(detail || "Verification failed.");
      throw new Error("admin verify failed");
    }
  }, []);

  const logout = useCallback(() => {
    setAdminToken(null);
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({ admin, loading, error, login, verify, logout }),
    [admin, loading, error, login, verify, logout]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return ctx;
}
