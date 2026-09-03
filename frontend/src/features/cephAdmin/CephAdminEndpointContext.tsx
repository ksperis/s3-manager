/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CephAdminEndpoint,
  CephAdminEndpointAccess,
  getCephAdminEndpointAccess,
  listCephAdminEndpoints,
} from "../../api/cephAdminEndpoints";
import { extractApiError } from "../../utils/apiError";
import { CLIENT_STORAGE_KEYS, readClientStorage, removeClientStorage, writeClientStorage } from "../../utils/clientStorage";
import { resolveUrlScopedSelection } from "../../utils/urlScopedSelection";

const ENDPOINT_STORAGE_KEY = CLIENT_STORAGE_KEYS.selectedCephAdminEndpoint;
const ENDPOINT_URL_PARAM = "ep";

type CephAdminEndpointContextValue = {
  endpoints: CephAdminEndpoint[];
  selectedEndpointId: number | null;
  setSelectedEndpointId: (id: number | null) => void;
  selectedEndpoint: CephAdminEndpoint | null;
  selectedEndpointAccess: CephAdminEndpointAccess | null;
  selectedEndpointAccessLoading: boolean;
  selectedEndpointAccessError: string | null;
  retrySelectedEndpointAccess: () => void;
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
  retrySelectedEndpointAccess: () => {},
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
  return extractApiError(err, "Unable to load Ceph Admin endpoint access.");
}

export function CephAdminEndpointProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [endpoints, setEndpoints] = useState<CephAdminEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEndpointAccess, setSelectedEndpointAccess] = useState<CephAdminEndpointAccess | null>(null);
  const [selectedEndpointAccessLoading, setSelectedEndpointAccessLoading] = useState(false);
  const [selectedEndpointAccessError, setSelectedEndpointAccessError] = useState<string | null>(null);
  const [endpointAccessRefreshToken, setEndpointAccessRefreshToken] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCephAdminEndpoints();
      setEndpoints(data);
    } catch (err) {
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
    const urlValue = parseEndpointId(searchParams.get(ENDPOINT_URL_PARAM));
    const storedValue = parseEndpointId(readClientStorage(ENDPOINT_STORAGE_KEY));
    const orderedEndpoints = [
      ...endpoints.filter((endpoint) => endpoint.is_default),
      ...endpoints.filter((endpoint) => !endpoint.is_default),
    ];
    const resolved = resolveUrlScopedSelection({
      availableIds: orderedEndpoints.map((endpoint) => String(endpoint.id)),
      urlValue: urlValue === null ? null : String(urlValue),
      currentValue: selectedEndpointId === null ? null : String(selectedEndpointId),
      fallbackValues: [storedValue === null ? null : String(storedValue)],
    });
    if (!resolved) return;
    const nextId = Number(resolved);
    if (nextId !== selectedEndpointId) {
      setSelectedEndpointIdState(nextId);
    }
    writeClientStorage(ENDPOINT_STORAGE_KEY, resolved);
    if (urlValue !== nextId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set(ENDPOINT_URL_PARAM, resolved);
      setSearchParams(nextParams, { replace: true });
    }
  }, [endpoints, searchParams, selectedEndpointId, setSearchParams]);

  const setSelectedEndpointId = useCallback((id: number | null) => {
    setSelectedEndpointIdState(id);
    const nextParams = new URLSearchParams(searchParams);
    if (id === null) {
      removeClientStorage(ENDPOINT_STORAGE_KEY);
      nextParams.delete(ENDPOINT_URL_PARAM);
    } else {
      writeClientStorage(ENDPOINT_STORAGE_KEY, String(id));
      nextParams.set(ENDPOINT_URL_PARAM, String(id));
    }
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectedEndpoint = useMemo(
    () => (selectedEndpointId ? endpoints.find((ep) => ep.id === selectedEndpointId) ?? null : null),
    [endpoints, selectedEndpointId]
  );
  const endpointDependentRoute = useMemo(() => {
    const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
    return normalizedPath !== "/ceph-admin" && normalizedPath !== "/ceph-admin/profile";
  }, [location.pathname]);

  useEffect(() => {
    const controller = new AbortController();
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
        const access = await getCephAdminEndpointAccess(selectedEndpointId, {
          probe: endpointDependentRoute,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setSelectedEndpointAccess(access);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setSelectedEndpointAccess(null);
          setSelectedEndpointAccessError(extractError(err));
        }
      } finally {
        if (!controller.signal.aborted) {
          setSelectedEndpointAccessLoading(false);
        }
      }
    }
    void loadSelectedEndpointAccess();
    return () => {
      controller.abort();
    };
  }, [endpointAccessRefreshToken, endpointDependentRoute, loading, selectedEndpointId]);

  const retrySelectedEndpointAccess = useCallback(() => {
    setEndpointAccessRefreshToken((value) => value + 1);
  }, []);

  const value = useMemo(
    () => ({
      endpoints,
      selectedEndpointId,
      setSelectedEndpointId,
      selectedEndpoint,
      selectedEndpointAccess,
      selectedEndpointAccessLoading,
      selectedEndpointAccessError,
      retrySelectedEndpointAccess,
      loading,
      error,
    }),
    [
      endpoints,
      selectedEndpointId,
      setSelectedEndpointId,
      selectedEndpoint,
      selectedEndpointAccess,
      selectedEndpointAccessLoading,
      selectedEndpointAccessError,
      retrySelectedEndpointAccess,
      loading,
      error,
    ]
  );

  return <CephAdminEndpointContext.Provider value={value}>{children}</CephAdminEndpointContext.Provider>;
}

export function useCephAdminEndpoint() {
  return useContext(CephAdminEndpointContext);
}
