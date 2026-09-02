/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import type { UserAvatarDescriptor } from "../../api/users";

type StoredUserProfilePatch = {
  fullName?: string | null;
  uiLanguage?: "en" | "fr" | "de" | null;
  uiPreferences?: Record<string, unknown> | null;
  avatar?: UserAvatarDescriptor | null;
};

export function updateStoredUserProfile(
  patch: StoredUserProfilePatch,
  options: { createIfMissing?: boolean } = {}
): boolean {
  const stored = readStoredUser();
  if (!stored && !options.createIfMissing) return false;
  const next = { ...(stored ?? {}) };
  if ("fullName" in patch) {
    next.full_name = patch.fullName ?? null;
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
  setSessionUserCache(next);
  return true;
}
