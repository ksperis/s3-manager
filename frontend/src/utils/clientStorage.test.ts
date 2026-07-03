import { beforeEach, describe, expect, it } from "vitest";

import {
  CLIENT_STORAGE_KEYS,
  clearAuthStorage,
  readClientJson,
  readClientStorage,
  removeClientStorage,
  writeClientJson,
  writeClientStorage,
} from "./clientStorage";

describe("clientStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reads and writes known local storage keys", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "portal");

    expect(readClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace)).toBe("portal");
  });

  it("parses JSON defensively", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.sessionUser, "{bad-json");

    expect(readClientJson(CLIENT_STORAGE_KEYS.sessionUser)).toBeNull();

    writeClientJson(CLIENT_STORAGE_KEYS.sessionUser, { role: "ui_admin" });

    expect(readClientJson<{ role: string }>(CLIENT_STORAGE_KEYS.sessionUser)).toEqual({ role: "ui_admin" });
  });

  it("clears auth storage without touching workspace preferences", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.authToken, "token");
    writeClientJson(CLIENT_STORAGE_KEYS.sessionUser, { role: "ui_user" });
    writeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint, "https://s3.example.test");
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "browser");

    clearAuthStorage();

    expect(readClientStorage(CLIENT_STORAGE_KEYS.authToken)).toBeNull();
    expect(readClientStorage(CLIENT_STORAGE_KEYS.sessionUser)).toBeNull();
    expect(readClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint)).toBeNull();
    expect(readClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace)).toBe("browser");
  });

  it("removes a known key", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.theme, "dark");

    removeClientStorage(CLIENT_STORAGE_KEYS.theme);

    expect(readClientStorage(CLIENT_STORAGE_KEYS.theme)).toBeNull();
  });

});
