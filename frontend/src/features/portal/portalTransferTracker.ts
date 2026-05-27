/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalWorkspaceTransfer } from "./portalWorkspaceMockData";

const STORAGE_KEY = "portal:v3:transfers";
const UPDATE_EVENT = "portal-transfers-updated";

export type PortalLocalTransfer = PortalWorkspaceTransfer & {
  accountId: string;
  spaceId: string;
  updatedAt: string;
  errorMessage?: string | null;
};

type TransferStartInput = {
  accountId: string;
  spaceId: string;
  spaceName: string;
  name: string;
  direction: PortalWorkspaceTransfer["direction"];
  sizeBytes?: number | null;
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAll(): PortalLocalTransfer[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PortalLocalTransfer[] : [];
  } catch {
    return [];
  }
}

function writeAll(transfers: PortalLocalTransfer[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers.slice(0, 40)));
  window.dispatchEvent(new Event(UPDATE_EVENT));
}

export function subscribePortalTransferUpdates(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(UPDATE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(UPDATE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function listPortalLocalTransfers(accountId?: string | null): PortalLocalTransfer[] {
  return readAll().filter((transfer) => !accountId || transfer.accountId === accountId);
}

export function startPortalTransfer(input: TransferStartInput): string {
  const now = new Date().toISOString();
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const transfer: PortalLocalTransfer = {
    id,
    accountId: input.accountId,
    spaceId: input.spaceId,
    name: input.name,
    direction: input.direction,
    status: input.direction === "Upload" ? "Uploading" : "Queued",
    progress: input.direction === "Upload" ? 10 : 0,
    sizeBytes: input.sizeBytes,
    spaceName: input.spaceName,
    startedLabel: "Now",
    etaLabel: input.direction === "Upload" ? "In progress" : "Queued",
    speedLabel: "-",
    updatedAt: now,
  };
  writeAll([transfer, ...readAll().filter((item) => item.id !== id)]);
  return id;
}

export function completePortalTransfer(id: string, name?: string): void {
  const now = new Date().toISOString();
  writeAll(
    readAll().map((transfer) =>
      transfer.id === id
        ? {
            ...transfer,
            name: name ?? transfer.name,
            status: "Completed",
            progress: 100,
            etaLabel: "Completed",
            updatedAt: now,
            errorMessage: null,
          }
        : transfer
    )
  );
}

export function failPortalTransfer(id: string, errorMessage: string): void {
  const now = new Date().toISOString();
  writeAll(
    readAll().map((transfer) =>
      transfer.id === id
        ? {
            ...transfer,
            status: "Failed",
            progress: 0,
            etaLabel: "-",
            updatedAt: now,
            errorMessage,
          }
        : transfer
    )
  );
}
