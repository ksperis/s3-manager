/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchGeneralSettings, GeneralSettings } from "../api/appSettings";

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: false,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: true,
  allow_portal_manager_workspace: false,
  portal_enabled: false,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_compare_enabled: true,
  manager_ceph_s3_user_keys_enabled: false,
  allow_ui_user_bucket_migration: false,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
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
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchGeneralSettings();
      setGeneralSettings(data);
    } catch (err) {
      console.error(err);
      setGeneralSettings(DEFAULT_GENERAL_SETTINGS);
    } finally {
      setLoading(false);
    }
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
    [generalSettings, loading, refresh]
  );

  return <GeneralSettingsContext.Provider value={value}>{children}</GeneralSettingsContext.Provider>;
}

export function useGeneralSettings() {
  return useContext(GeneralSettingsContext);
}

export { DEFAULT_GENERAL_SETTINGS };
