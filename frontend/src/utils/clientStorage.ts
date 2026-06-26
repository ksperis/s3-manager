/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export const CLIENT_STORAGE_KEYS = {
  authToken: "token",
  sessionUser: "user",
  s3SessionEndpoint: "s3SessionEndpoint",
  selectedWorkspace: "selectedWorkspace",
  selectedExecutionContext: "selectedExecutionContextId",
  selectedPortalAccount: "selectedPortalAccountId",
  selectedCephAdminEndpoint: "selectedCephAdminEndpointId",
  theme: "theme",
  brandingPrimaryColor: "branding.primary_color",
  selectorTagsPreference: "showSelectorTags",
  portalTransfers: "portal:v3:transfers",
  browserRootUiState: "browser:root-ui-state:v1",
  browserPathHistory: "browser:path-history:v1",
  browserEmbeddedObjectColumns: "browser:embedded-object-columns:v1",
  browserEmbeddedObjectColumnWidths: "browser:embedded-object-column-widths:v1",
} as const;

export type ClientStorageKey = (typeof CLIENT_STORAGE_KEYS)[keyof typeof CLIENT_STORAGE_KEYS];
export type LegacyClientStorageKey = string;

function resolveLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
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

export function readLegacyClientStorage(key: LegacyClientStorageKey): string | null {
  try {
    return resolveLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function readClientStorageWithFallback(
  key: ClientStorageKey,
  legacyKeys: LegacyClientStorageKey[] = []
): string | null {
  const current = readClientStorage(key);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    const legacyValue = readLegacyClientStorage(legacyKey);
    if (legacyValue !== null) return legacyValue;
  }
  return null;
}

export function migrateClientStorageKey(
  key: ClientStorageKey,
  legacyKeys: LegacyClientStorageKey[],
  options: { removeLegacy?: boolean } = {}
): string | null {
  const current = readClientStorage(key);
  if (current !== null) return current;
  for (const legacyKey of legacyKeys) {
    const legacyValue = readLegacyClientStorage(legacyKey);
    if (legacyValue === null) continue;
    writeClientStorage(key, legacyValue);
    if (options.removeLegacy) {
      try {
        resolveLocalStorage()?.removeItem(legacyKey);
      } catch {
        // Ignore storage failures in private mode or disabled storage.
      }
    }
    return legacyValue;
  }
  return null;
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

export function readClientJsonFromKey<T>(key: ClientStorageKey | LegacyClientStorageKey): T | null {
  const raw = readClientStorageKey(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeClientJsonToKey(key: ClientStorageKey | LegacyClientStorageKey, value: unknown): void {
  writeClientStorageKey(key, JSON.stringify(value));
}

export function readClientStorageKey(key: ClientStorageKey | LegacyClientStorageKey): string | null {
  try {
    return resolveLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeClientStorageKey(key: ClientStorageKey | LegacyClientStorageKey, value: string): void {
  try {
    resolveLocalStorage()?.setItem(key, value);
  } catch {
    // Ignore storage failures in private mode, disabled storage, or quota pressure.
  }
}

export function clearAuthStorage(): void {
  removeClientStorage(CLIENT_STORAGE_KEYS.authToken);
  removeClientStorage(CLIENT_STORAGE_KEYS.sessionUser);
  removeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint);
}
