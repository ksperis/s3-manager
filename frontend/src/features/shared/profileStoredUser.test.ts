import { beforeEach, describe, expect, it } from "vitest";

import { readStoredUser, setSessionUserCache } from "../../utils/workspaces";
import { updateStoredUserProfile } from "./profileStoredUser";

describe("updateStoredUserProfile", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setSessionUserCache(null);
  });

  it("merges profile fields into an existing stored user", () => {
    setSessionUserCache({ email: "me@example.test", role: "ui_user" });

    expect(updateStoredUserProfile({ fullName: "Ada Lovelace", uiLanguage: "fr" })).toBe(true);

    expect(readStoredUser()).toEqual({
      email: "me@example.test",
      role: "ui_user",
      full_name: "Ada Lovelace",
      ui_language: "fr",
    });
  });

  it("can create a stored user shell when a Portal profile refresh has no cache yet", () => {
    expect(
      updateStoredUserProfile(
        {
          fullName: "Grace Hopper",
          uiPreferences: { theme: "dark" },
        },
        { createIfMissing: true }
      )
    ).toBe(true);

    expect(readStoredUser()).toEqual({
      full_name: "Grace Hopper",
      ui_preferences: { theme: "dark" },
    });
  });
});
