/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const CLIENT_STORAGE_KEYS = {
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
type StorageResolver = () => Storage | null;

function resolveLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function resolveSessionStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function readStorageKey(resolveStorage: StorageResolver, key: string): string | null {
  try {
    return resolveStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageKey(resolveStorage: StorageResolver, key: string, value: string): void {
  try {
    resolveStorage()?.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode, disabled storage, or quota pressure.
  }
}

function removeStorageKey(resolveStorage: StorageResolver, key: string): void {
  try {
    resolveStorage()?.removeItem(key);
  } catch {
    // Ignore storage failures in private mode or disabled storage.
  }
}

function parseStoredJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readClientStorage(key: ClientStorageKey): string | null {
  return readClientStorageKey(key);
}

export function writeClientStorage(key: ClientStorageKey, value: string): void {
  writeClientStorageKey(key, value);
}

export function removeClientStorage(key: ClientStorageKey): void {
  removeClientStorageKey(key);
}

export function readClientJson<T>(key: ClientStorageKey): T | null {
  return readClientJsonFromKey<T>(key);
}

export function writeClientJson(key: ClientStorageKey, value: unknown): void {
  writeClientJsonToKey(key, value);
}

export function readClientJsonFromKey<T>(key: ClientStorageKey | ClientStorageRawKey): T | null {
  return parseStoredJson<T>(readClientStorageKey(key));
}

export function writeClientJsonToKey(key: ClientStorageKey | ClientStorageRawKey, value: unknown): void {
  writeClientStorageKey(key, JSON.stringify(value));
}

export function readClientStorageKey(key: ClientStorageKey | ClientStorageRawKey): string | null {
  return readStorageKey(resolveLocalStorage, key);
}

export function writeClientStorageKey(key: ClientStorageKey | ClientStorageRawKey, value: string): void {
  writeStorageKey(resolveLocalStorage, key, value);
}

export function removeClientStorageKey(key: ClientStorageKey | ClientStorageRawKey): void {
  removeStorageKey(resolveLocalStorage, key);
}

function readSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey): string | null {
  return readStorageKey(resolveSessionStorage, key);
}

function writeSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey, value: string): void {
  writeStorageKey(resolveSessionStorage, key, value);
}

export function removeSessionStorageKey(key: ClientStorageKey | ClientStorageRawKey): void {
  removeStorageKey(resolveSessionStorage, key);
}

export function readSessionJsonFromKey<T>(key: ClientStorageKey | ClientStorageRawKey): T | null {
  return parseStoredJson<T>(readSessionStorageKey(key));
}

export function writeSessionJsonToKey(key: ClientStorageKey | ClientStorageRawKey, value: unknown): void {
  writeSessionStorageKey(key, JSON.stringify(value));
}

export function clearAuthStorage(): void {
  // Remove pre-cutover bearer state as well as the current non-secret caches.
  // Keeping the raw legacy key out of CLIENT_STORAGE_KEYS prevents new code
  // from treating browser token storage as a supported contract.
  removeClientStorageKey("token");
  removeClientStorage(CLIENT_STORAGE_KEYS.sessionUser);
  removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
}
