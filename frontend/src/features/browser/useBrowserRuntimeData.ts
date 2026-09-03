/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  fetchBrowserSettings,
  fetchBrowserUsageSummary,
} from "../../api/browserBuckets";
import type {
  BrowserSettings,
  BrowserUsageSummary,
} from "../../api/browserContracts";
import { extractApiError } from "../../utils/apiError";

type UseBrowserRuntimeDataOptions = {
  accountId: S3AccountSelector;
  enabled: boolean;
  requestOptions?: BrowserRequestOptions;
  showUsage: boolean;
};

type SettingsState = {
  key: string;
  value: BrowserSettings | null;
};

type UsageState = {
  key: string;
  value: BrowserUsageSummary | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_SETTINGS_STATE: SettingsState = {
  key: "",
  value: null,
};

const EMPTY_USAGE_STATE: UsageState = {
  key: "",
  value: null,
  loading: false,
  error: null,
};

const hasAccountSelector = (accountId: S3AccountSelector) =>
  accountId !== null && accountId !== undefined && accountId !== "";

export function useBrowserRuntimeData({
  accountId,
  enabled,
  requestOptions,
  showUsage,
}: UseBrowserRuntimeDataOptions) {
  const [settingsState, setSettingsState] = useState<SettingsState>(
    EMPTY_SETTINGS_STATE,
  );
  const [usageState, setUsageState] =
    useState<UsageState>(EMPTY_USAGE_STATE);
  const stableRequestOptions = useMemo<BrowserRequestOptions | undefined>(
    () =>
      requestOptions?.workspaceSurface
        ? { workspaceSurface: requestOptions.workspaceSurface }
        : undefined,
    [requestOptions?.workspaceSurface],
  );
  const canLoad = enabled && hasAccountSelector(accountId);
  const settingsKey = JSON.stringify([
    accountId ?? null,
    canLoad,
    stableRequestOptions?.workspaceSurface ?? null,
  ]);
  const usageKey = JSON.stringify([settingsKey, showUsage]);
  const canLoadUsage = canLoad && showUsage;

  useLayoutEffect(() => {
    setSettingsState({ key: settingsKey, value: null });
  }, [settingsKey]);

  useLayoutEffect(() => {
    setUsageState({
      key: usageKey,
      value: null,
      loading: canLoadUsage,
      error: null,
    });
  }, [canLoadUsage, usageKey]);

  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    fetchBrowserSettings(accountId, stableRequestOptions)
      .then((value) => {
        if (active) setSettingsState({ key: settingsKey, value });
      })
      .catch(() => {
        if (active) setSettingsState({ key: settingsKey, value: null });
      });
    return () => {
      active = false;
    };
  }, [accountId, canLoad, settingsKey, stableRequestOptions]);

  useEffect(() => {
    if (!canLoadUsage) return;
    let active = true;
    fetchBrowserUsageSummary(accountId, stableRequestOptions)
      .then((value) => {
        if (!active) return;
        setUsageState({
          key: usageKey,
          value: value.available ? value : null,
          loading: false,
          error: null,
        });
      })
      .catch((loadError) => {
        if (!active) return;
        setUsageState({
          key: usageKey,
          value: null,
          loading: false,
          error: extractApiError(loadError, "Usage is not available."),
        });
      });
    return () => {
      active = false;
    };
  }, [accountId, canLoadUsage, stableRequestOptions, usageKey]);

  const settings =
    settingsState.key === settingsKey ? settingsState.value : null;
  const currentUsage = usageState.key === usageKey ? usageState : null;

  return {
    settings,
    usageError: canLoadUsage ? (currentUsage?.error ?? null) : null,
    usageLoading: canLoadUsage
      ? (currentUsage?.loading ?? true)
      : false,
    usageSummary: canLoadUsage ? (currentUsage?.value ?? null) : null,
  };
}
