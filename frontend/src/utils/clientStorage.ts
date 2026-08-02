/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const CLIENT_STORAGE_KEYS = {
  authToken: "token",
  sessionUser: "user",
  s3SessionEndpoint: "s3SessionEndpoint",
  selectedWorkspace: "selectedWorkspace",
  selectedManagerExecutionContext: "selectedManagerExecutionContextId",
  selectedBrowserExecutionContext: "selectedBrowserExecutionContextId",
  selectedPortalAccount: "selectedPortalAccountId",
  selectedCephAdminEndpoint: "selectedCephAdminEndpointId",
  theme: "theme",
  brandingPrimaryColor: "branding.primary_color",
  generalSettingsCache: "settings:general:v1",
  selectorTagsPreference: "showSelectorTags",
  browserRootUiStateV2: "browser:root-ui-state:v2",
  browserRootContextSelections: "browser:root-context-selections:v2",
  browserPathHistory: "browser:path-history:v1",
  browserEmbeddedObjectColumns: "browser:embedded-object-columns:v1",
  browserEmbeddedObjectColumnWidths: "browser:embedded-object-column-widths:v1",
} as const;

type ClientStorageKey = (typeof CLIENT_STORAGE_KEYS)[keyof typeof CLIENT_STORAGE_KEYS];
type ClientStorageRawKey = string;

function resolveLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function resolveSessionStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function readClientStorage(key: ClientStorageKey): string | null {
  try {
    return resolveLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeClientStorage(key: ClientStorageKey, value: string): void {
  try {
    resolveLocalStorage()?.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode, disabled storage, or quota pressure.
  }
}

export function removeClientStorage(key: ClientStorageKey): void {
  try {
    resolveLocalStorage()?.removeItem(key);
  } catch {
    // Ignore storage failures in private mode or disabled storage.
  }
}

export function readClientJson<T>(key: ClientStorageKey): T | null {
  const raw = readClientStorage(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeClientJson(key: ClientStorageKey, value: unknown): void {
  writeClientStorage(key, JSON.stringify(value));
}

export function readClientJsonFromKey<T>(key: ClientStorageKey | ClientStorageRawKey): T | null {
  const raw = readClientStorageKey(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeClientJsonToKey(key: ClientStorageKey | ClientStorageRawKey, value: unknown): void {
  writeClientStorageKey(key, JSON.stringify(value));
}

export function readClientStorageKey(key: ClientStorageKey | ClientStorageRawKey): string | null {
  try {
    return resolveLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeClientStorageKey(key: ClientStorageKey | ClientStorageRawKey, value: string): void {
  try {
    resolveLocalStorage()?.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode, disabled storage, or quota pressure.
  }
}

export function removeClientStorageKey(key: ClientStorageKey | ClientStorageRawKey): void {
  try {
    resolveLocalStorage()?.removeItem(key);
  } catch {
    // Ignore storage failures in private mode or disabled storage.
  }
}

function readSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey): string | null {
  try {
    return resolveSessionStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey, value: string): void {
  try {
    resolveSessionStorage()?.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode, disabled storage, or quota pressure.
  }
}

export function removeSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey): void {
  try {
    resolveSessionStorage()?.removeItem(key);
  } catch {
    // Ignore storage failures in private mode or disabled storage.
  }
}

export function readSessionJsonFromKey<T>(key: ClientStorageKey | ClientStorageRawKey): T | null {
  const raw = readSessionStorageKey(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSessionJsonToKey(key: ClientStorageKey | ClientStorageRawKey, value: unknown): void {
  writeSessionStorageKey(key, JSON.stringify(value));
}

export function clearAuthStorage(): void {
  removeClientStorage(CLIENT_STORAGE_KEYS.authToken);
  removeClientStorage(CLIENT_STORAGE_KEYS.sessionUser);
  removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
}
