/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { CephAdminEndpoint, CephAdminEndpointAccess, getCephAdminEndpointAccess, listCephAdminEndpoints } from "../../api/cephAdmin";

const ENDPOINT_STORAGE_KEY = "selectedCephAdminEndpointId";
const ENDPOINT_URL_PARAM = "ep";

type CephAdminEndpointContextValue = {
  endpoints: CephAdminEndpoint[];
  selectedEndpointId: number | null;
  setSelectedEndpointId: (id: number | null) => void;
  selectedEndpoint: CephAdminEndpoint | null;
  selectedEndpointAccess: CephAdminEndpointAccess | null;
  selectedEndpointAccessLoading: boolean;
  selectedEndpointAccessError: string | null;
  loading: boolean;
  error: string | null;
};

const CephAdminEndpointContext = createContext<CephAdminEndpointContextValue>({
  endpoints: [],
  selectedEndpointId: null,
  setSelectedEndpointId: () => {},
  selectedEndpoint: null,
  selectedEndpointAccess: null,
  selectedEndpointAccessLoading: false,
  selectedEndpointAccessError: null,
  loading: false,
  error: null,
});

function parseEndpointId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
}

export function CephAdminEndpointProvider({ children }: { children: ReactNode }) {
  const [endpoints, setEndpoints] = useState<CephAdminEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEndpointAccess, setSelectedEndpointAccess] = useState<CephAdminEndpointAccess | null>(null);
  const [selectedEndpointAccessLoading, setSelectedEndpointAccessLoading] = useState(false);
  const [selectedEndpointAccessError, setSelectedEndpointAccessError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCephAdminEndpoints();
      setEndpoints(data);
    } catch (err) {
      console.error(err);
      setEndpoints([]);
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (endpoints.length === 0) {
      setSelectedEndpointIdState(null);
      return;
    }
    const hasEndpoint = (value: number | null) =>
      value !== null && endpoints.some((ep) => ep.id === value);
    const urlValue = parseEndpointId(searchParams.get(ENDPOINT_URL_PARAM));
    if (hasEndpoint(selectedEndpointId)) {
      if (urlValue !== selectedEndpointId) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set(ENDPOINT_URL_PARAM, String(selectedEndpointId));
        setSearchParams(nextParams, { replace: true });
      }
      localStorage.setItem(ENDPOINT_STORAGE_KEY, String(selectedEndpointId));
      return;
    }
    if (hasEndpoint(urlValue)) {
      setSelectedEndpointIdState(urlValue);
      localStorage.setItem(ENDPOINT_STORAGE_KEY, String(urlValue));
      return;
    }
    const storedValue = parseEndpointId(localStorage.getItem(ENDPOINT_STORAGE_KEY));
    if (hasEndpoint(storedValue)) {
      setSelectedEndpointIdState(storedValue);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(ENDPOINT_URL_PARAM, String(storedValue));
      setSearchParams(nextParams, { replace: true });
      localStorage.setItem(ENDPOINT_STORAGE_KEY, String(storedValue));
      return;
    }
    const fallback = endpoints.find((ep) => ep.is_default) ?? endpoints[0];
    setSelectedEndpointIdState(fallback.id);
    localStorage.setItem(ENDPOINT_STORAGE_KEY, String(fallback.id));
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set(ENDPOINT_URL_PARAM, String(fallback.id));
    setSearchParams(nextParams, { replace: true });
  }, [endpoints, searchParams, selectedEndpointId, setSearchParams]);

  const setSelectedEndpointId = (id: number | null) => {
    setSelectedEndpointIdState(id);
    const nextParams = new URLSearchParams(searchParams);
    if (id === null) {
      localStorage.removeItem(ENDPOINT_STORAGE_KEY);
      nextParams.delete(ENDPOINT_URL_PARAM);
    } else {
      localStorage.setItem(ENDPOINT_STORAGE_KEY, String(id));
      nextParams.set(ENDPOINT_URL_PARAM, String(id));
    }
    setSearchParams(nextParams, { replace: true });
  };

  const selectedEndpoint = useMemo(
    () => (selectedEndpointId ? endpoints.find((ep) => ep.id === selectedEndpointId) ?? null : null),
    [endpoints, selectedEndpointId]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSelectedEndpointAccess() {
      if (loading) return;
      if (selectedEndpointId == null) {
        setSelectedEndpointAccess(null);
        setSelectedEndpointAccessError(null);
        setSelectedEndpointAccessLoading(false);
        return;
      }
      setSelectedEndpointAccess(null);
      setSelectedEndpointAccessError(null);
      setSelectedEndpointAccessLoading(true);
      try {
        const access = await getCephAdminEndpointAccess(selectedEndpointId);
        if (!cancelled) {
          setSelectedEndpointAccess(access);
        }
      } catch (err) {
        if (!cancelled) {
          setSelectedEndpointAccess(null);
          setSelectedEndpointAccessError(extractError(err));
        }
      } finally {
        if (!cancelled) {
          setSelectedEndpointAccessLoading(false);
        }
      }
    }
    void loadSelectedEndpointAccess();
    return () => {
      cancelled = true;
    };
  }, [loading, selectedEndpointId]);

  const value = useMemo(
    () => ({
      endpoints,
      selectedEndpointId,
      setSelectedEndpointId,
      selectedEndpoint,
      selectedEndpointAccess,
      selectedEndpointAccessLoading,
      selectedEndpointAccessError,
      loading,
      error,
    }),
    [
      endpoints,
      selectedEndpointId,
      selectedEndpoint,
      selectedEndpointAccess,
      selectedEndpointAccessLoading,
      selectedEndpointAccessError,
      loading,
      error,
    ]
  );

  return <CephAdminEndpointContext.Provider value={value}>{children}</CephAdminEndpointContext.Provider>;
}

export function useCephAdminEndpoint() {
  return useContext(CephAdminEndpointContext);
}
