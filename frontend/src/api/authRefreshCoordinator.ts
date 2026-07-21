/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  CLIENT_STORAGE_KEYS,
  readClientStorage,
  readClientStorageKey,
  removeClientStorageKey,
  writeClientStorageKey,
} from "../utils/clientStorage";

const AUTH_REFRESH_LOCK_NAME = "s3-manager.auth-refresh";
const AUTH_REFRESH_LEASE_KEY = "s3-manager.auth-refresh.lease.v1";
const AUTH_REFRESH_LEASE_MS = 12_000;
const AUTH_REFRESH_WAIT_MS = 40;

type RefreshLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
};

type AuthRefreshCoordinatorDependencies = {
  locks?: RefreshLockManager | null;
  readToken?: () => string | null;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  ownerId?: string;
};

type RefreshLease = {
  owner: string;
  expiresAt: number;
};

const defaultWait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

function defaultLockManager(): RefreshLockManager | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { locks?: RefreshLockManager }).locks ?? null;
}

function createOwnerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseLease(raw: string | null): RefreshLease | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RefreshLease>;
    if (typeof parsed.owner !== "string" || typeof parsed.expiresAt !== "number") return null;
    return { owner: parsed.owner, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function currentAccessToken(): string | null {
  return readClientStorage(CLIENT_STORAGE_KEYS.authToken);
}

function tokenRenewedSince(observedToken: string | null, readToken: () => string | null): string | null {
  if (!observedToken) return null;
  const current = readToken();
  return current && current !== observedToken ? current : null;
}

async function runWithStorageLease(
  observedToken: string | null,
  refresh: () => Promise<string>,
  dependencies: Required<Pick<AuthRefreshCoordinatorDependencies, "readToken" | "now" | "wait" | "ownerId">>,
): Promise<string> {
  const { readToken, now, wait, ownerId } = dependencies;
  let failedLeaseAttempts = 0;
  while (true) {
    const renewed = tokenRenewedSince(observedToken, readToken);
    if (renewed) return renewed;

    const lease = parseLease(readClientStorageKey(AUTH_REFRESH_LEASE_KEY));
    if (!lease || lease.expiresAt <= now() || lease.owner === ownerId) {
      writeClientStorageKey(AUTH_REFRESH_LEASE_KEY, JSON.stringify({
        owner: ownerId,
        expiresAt: now() + AUTH_REFRESH_LEASE_MS,
      } satisfies RefreshLease));
      await wait(AUTH_REFRESH_WAIT_MS);
      const confirmed = parseLease(readClientStorageKey(AUTH_REFRESH_LEASE_KEY));
      if (confirmed?.owner === ownerId) {
        try {
          const latest = tokenRenewedSince(observedToken, readToken);
          return latest ?? await refresh();
        } finally {
          const currentLease = parseLease(readClientStorageKey(AUTH_REFRESH_LEASE_KEY));
          if (currentLease?.owner === ownerId) {
            removeClientStorageKey(AUTH_REFRESH_LEASE_KEY);
          }
        }
      }
      failedLeaseAttempts += 1;
      if (failedLeaseAttempts >= 3 && !confirmed) {
        return refresh();
      }
    }
    await wait(AUTH_REFRESH_WAIT_MS);
  }
}

/**
 * Serialize refresh-token rotation across tabs. The second tab reuses the
 * access token written by the first instead of consuming the rotated cookie.
 */
export async function coordinateAuthRefresh(
  observedToken: string | null,
  refresh: () => Promise<string>,
  dependencies: AuthRefreshCoordinatorDependencies = {},
): Promise<string> {
  const readToken = dependencies.readToken ?? currentAccessToken;
  const run = async () => tokenRenewedSince(observedToken, readToken) ?? await refresh();
  const locks = dependencies.locks === undefined ? defaultLockManager() : dependencies.locks;
  if (locks) {
    return locks.request(AUTH_REFRESH_LOCK_NAME, { mode: "exclusive" }, run);
  }
  return runWithStorageLease(observedToken, refresh, {
    readToken,
    now: dependencies.now ?? Date.now,
    wait: dependencies.wait ?? defaultWait,
    ownerId: dependencies.ownerId ?? createOwnerId(),
  });
}
