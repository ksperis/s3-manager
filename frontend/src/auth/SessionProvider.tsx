/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchCurrentSession, type AuthenticationResponse, type CurrentSessionResponse } from "../api/auth";
import { clearAuthStorage, removeClientStorage, CLIENT_STORAGE_KEYS } from "../utils/clientStorage";
import type { SessionUser } from "../utils/workspaces";
import { readStoredUser, setSessionUserCache } from "../utils/workspaces";

type SessionContextValue = {
  loading: boolean;
  authenticated: boolean;
  user: SessionUser | null;
  session: CurrentSessionResponse | null;
  refresh: () => Promise<CurrentSessionResponse | null>;
  acceptAuthentication: (response: AuthenticationResponse, authType: SessionUser["authType"]) => void;
  clear: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function sessionUserFromResponse(response: CurrentSessionResponse): SessionUser | null {
  if (response.user) return { ...response.user, authType: response.auth_session.auth_type as SessionUser["authType"] };
  if (!response.session) return null;
  return {
    email: response.session.account_id ? `${response.session.account_id}@s3-session` : "s3-session",
    role: "ui_user",
    authType: "s3_session",
    actorType: response.session.actor_type,
    accountId: response.session.account_id ?? null,
    accountName: response.session.account_name ?? null,
    capabilities: response.session.capabilities,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<CurrentSessionResponse | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  const clear = useCallback(() => {
    clearAuthStorage();
    setSessionUserCache(null);
    setSession(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = await fetchCurrentSession();
      const nextUser = sessionUserFromResponse(current);
      setSession(current);
      setUser(nextUser);
      setSessionUserCache(nextUser);
      return current;
    } catch {
      clear();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clear]);

  const acceptAuthentication = useCallback((response: AuthenticationResponse, authType: SessionUser["authType"]) => {
    if (response.status !== "authenticated") return;
    let nextUser: SessionUser | null = null;
    if (response.user) nextUser = { ...response.user, authType };
    else if (response.session) {
      nextUser = {
        email: response.session.account_id ? `${response.session.account_id}@s3-session` : "s3-session",
        role: "ui_user",
        authType: "s3_session",
        actorType: response.session.actor_type,
        accountId: response.session.account_id ?? null,
        accountName: response.session.account_name ?? null,
        capabilities: response.session.capabilities,
      };
    }
    setUser(nextUser);
    setSessionUserCache(nextUser);
    removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
    setLoading(false);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const ended = () => clear();
    window.addEventListener("s3-manager:session-ended", ended);
    return () => window.removeEventListener("s3-manager:session-ended", ended);
  }, [clear, refresh]);

  const value = useMemo(() => ({
    loading,
    authenticated: Boolean(session && user),
    user,
    session,
    refresh,
    acceptAuthentication,
    clear,
  }), [acceptAuthentication, clear, loading, refresh, session, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context) return context;
  const user = readStoredUser();
  return {
    loading: false,
    authenticated: Boolean(user),
    user,
    session: null,
    refresh: async () => null,
    acceptAuthentication: (response, authType) => {
      if (response.user) setSessionUserCache({ ...response.user, authType });
    },
    clear: clearAuthStorage,
  };
}
