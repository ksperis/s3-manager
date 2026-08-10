/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchGeneralSettings, GeneralSettings } from "../api/appSettings";
import {
  CLIENT_STORAGE_KEYS,
  readClientJson,
  readClientStorage,
  writeClientJson,
} from "../utils/clientStorage";

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: false,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: true,
  quota_alerts_enabled: false,
  usage_history_enabled: true,
  bucket_migration_enabled: false,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_usage_stats_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
};

type GeneralSettingsContextValue = {
  generalSettings: GeneralSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  setGeneralSettings: (settings: GeneralSettings) => void;
};

const GeneralSettingsContext = createContext<GeneralSettingsContextValue>({
  generalSettings: DEFAULT_GENERAL_SETTINGS,
  loading: false,
  refresh: async () => {},
  setGeneralSettings: () => {},
});

export function GeneralSettingsProvider({ children }: { children: ReactNode }) {
  const [cachedSettings] = useState(() => readClientJson<GeneralSettings>(CLIENT_STORAGE_KEYS.generalSettingsCache));
  const [generalSettings, setGeneralSettingsState] = useState<GeneralSettings>(cachedSettings ?? DEFAULT_GENERAL_SETTINGS);
  const [loading, setLoading] = useState(
    () => Boolean(readClientStorage(CLIENT_STORAGE_KEYS.authToken)) && cachedSettings == null
  );

  const refresh = useCallback(async () => {
    const token = readClientStorage(CLIENT_STORAGE_KEYS.authToken);
    if (!token) {
      setGeneralSettingsState(DEFAULT_GENERAL_SETTINGS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchGeneralSettings();
      setGeneralSettingsState(data);
      writeClientJson(CLIENT_STORAGE_KEYS.generalSettingsCache, data);
    } catch {
      if (!cachedSettings) setGeneralSettingsState(DEFAULT_GENERAL_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, [cachedSettings]);

  const setGeneralSettings = useCallback((settings: GeneralSettings) => {
    setGeneralSettingsState(settings);
    writeClientJson(CLIENT_STORAGE_KEYS.generalSettingsCache, settings);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      generalSettings,
      loading,
      refresh,
      setGeneralSettings,
    }),
    [generalSettings, loading, refresh, setGeneralSettings]
  );

  return <GeneralSettingsContext.Provider value={value}>{children}</GeneralSettingsContext.Provider>;
}

export function useGeneralSettings() {
  return useContext(GeneralSettingsContext);
}

export { DEFAULT_GENERAL_SETTINGS };
