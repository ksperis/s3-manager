/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { CLIENT_STORAGE_KEYS, readClientJson, writeClientJson } from "../../utils/clientStorage";
import { SESSION_USER_UPDATED_EVENT } from "../../utils/workspaces";
import type { UserAvatarDescriptor } from "../../api/users";

type StoredUserProfilePatch = {
  fullName?: string | null;
  displayName?: string | null;
  uiLanguage?: "en" | "fr" | "de" | null;
  uiPreferences?: Record<string, unknown> | null;
  avatar?: UserAvatarDescriptor | null;
};

export function updateStoredUserProfile(
  patch: StoredUserProfilePatch,
  options: { createIfMissing?: boolean } = {}
): boolean {
  const stored = readClientJson<Record<string, unknown>>(CLIENT_STORAGE_KEYS.sessionUser);
  if (!stored && !options.createIfMissing) return false;
  const next = { ...(stored ?? {}) };
  if ("fullName" in patch) {
    next.full_name = patch.fullName ?? null;
    next.display_name = patch.displayName ?? patch.fullName ?? null;
  } else if ("displayName" in patch) {
    next.display_name = patch.displayName ?? null;
  }
  if ("uiLanguage" in patch) {
    next.ui_language = patch.uiLanguage ?? null;
  }
  if ("uiPreferences" in patch) {
    next.ui_preferences = patch.uiPreferences ?? {};
  }
  if ("avatar" in patch) {
    next.avatar = patch.avatar ?? null;
  }
  writeClientJson(CLIENT_STORAGE_KEYS.sessionUser, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_USER_UPDATED_EVENT));
  }
  return true;
}
