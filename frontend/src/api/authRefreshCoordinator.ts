/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  readClientStorageKey,
  removeClientStorageKey,
  writeClientStorageKey,
} from "../utils/clientStorage";

const AUTH_REFRESH_LOCK_NAME = "s3-manager.auth-refresh";
const AUTH_REFRESH_LEASE_KEY = "s3-manager.auth-refresh.lease.v2";
const AUTH_REFRESH_COMPLETED_KEY = "s3-manager.auth-refresh.completed.v2";
const AUTH_REFRESH_LEASE_MS = 12_000;
const AUTH_REFRESH_WAIT_MS = 50;

type RefreshLockManager = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T>): Promise<T>;
};

function lockManager(): RefreshLockManager | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { locks?: RefreshLockManager }).locks ?? null;
}

function marker(): number {
  return Number(readClientStorageKey(AUTH_REFRESH_COMPLETED_KEY) ?? "0") || 0;
}

function markComplete(): void {
  writeClientStorageKey(AUTH_REFRESH_COMPLETED_KEY, String(Date.now()));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(AUTH_REFRESH_LOCK_NAME);
    channel.postMessage({ type: "refreshed" });
    channel.close();
  }
}

async function executeIfNeeded(observed: number, refresh: () => Promise<void>): Promise<void> {
  if (marker() > observed) return;
  await refresh();
  markComplete();
}

export async function coordinateAuthRefresh(refresh: () => Promise<void>): Promise<void> {
  const observed = marker();
  const locks = lockManager();
  if (locks) {
    await locks.request(AUTH_REFRESH_LOCK_NAME, { mode: "exclusive" }, () => executeIfNeeded(observed, refresh));
    return;
  }

  const owner = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  while (true) {
    if (marker() > observed) return;
    const now = Date.now();
    let lease: { owner?: string; expiresAt?: number } = {};
    try {
      lease = JSON.parse(readClientStorageKey(AUTH_REFRESH_LEASE_KEY) ?? "{}") as typeof lease;
    } catch {
      lease = {};
    }
    if (!lease.owner || Number(lease.expiresAt) <= now) {
      writeClientStorageKey(AUTH_REFRESH_LEASE_KEY, JSON.stringify({ owner, expiresAt: now + AUTH_REFRESH_LEASE_MS }));
      await new Promise((resolve) => window.setTimeout(resolve, AUTH_REFRESH_WAIT_MS));
      const confirmed = readClientStorageKey(AUTH_REFRESH_LEASE_KEY) ?? "";
      if (confirmed.includes(owner)) {
        try {
          await executeIfNeeded(observed, refresh);
        } finally {
          removeClientStorageKey(AUTH_REFRESH_LEASE_KEY);
        }
        return;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, AUTH_REFRESH_WAIT_MS));
  }
}
