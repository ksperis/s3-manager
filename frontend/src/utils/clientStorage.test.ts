import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLIENT_STORAGE_KEYS,
  clearAuthStorage,
  readClientJson,
  readClientJsonFromKey,
  readClientStorage,
  readClientStorageKey,
  readSessionJsonFromKey,
  removeClientStorage,
  removeClientStorageKey,
  removeSessionStorageKey,
  writeClientJson,
  writeClientJsonToKey,
  writeClientStorage,
  writeClientStorageKey,
  writeSessionJsonToKey,
} from "./clientStorage";

describe("clientStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("reads and writes known local storage keys", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "portal");

    expect(readClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace)).toBe("portal");
  });

  it("parses JSON defensively", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.generalSettingsCache, "{bad-json");

    expect(readClientJson(CLIENT_STORAGE_KEYS.generalSettingsCache)).toBeNull();

    writeClientJson(CLIENT_STORAGE_KEYS.generalSettingsCache, { portal_enabled: true });

    expect(readClientJson<{ portal_enabled: boolean }>(CLIENT_STORAGE_KEYS.generalSettingsCache)).toEqual({
      portal_enabled: true,
    });
  });

  it("clears auth storage without touching workspace preferences", () => {
    window.localStorage.setItem("token", "legacy-bearer-token");
    window.localStorage.setItem("user", JSON.stringify({ role: "ui_user" }));
    writeClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint, "https://s3.example.test");
    writeClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace, "browser");

    clearAuthStorage();

    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.localStorage.getItem("user")).toBeNull();
    expect(readClientStorage(CLIENT_STORAGE_KEYS.s3SessionEndpoint)).toBeNull();
    expect(readClientStorage(CLIENT_STORAGE_KEYS.selectedWorkspace)).toBe("browser");
  });

  it("removes a known key", () => {
    writeClientStorage(CLIENT_STORAGE_KEYS.theme, "dark");

    removeClientStorage(CLIENT_STORAGE_KEYS.theme);

    expect(readClientStorage(CLIENT_STORAGE_KEYS.theme)).toBeNull();
  });

  it("supports dynamic local and session storage keys", () => {
    writeClientStorageKey("dynamic-text", "value");
    writeClientJsonToKey("dynamic-json", { page: 2 });
    writeSessionJsonToKey("dynamic-session", ["used_bytes"]);

    expect(readClientStorageKey("dynamic-text")).toBe("value");
    expect(readClientJsonFromKey<{ page: number }>("dynamic-json")).toEqual({ page: 2 });
    expect(readSessionJsonFromKey<string[]>("dynamic-session")).toEqual(["used_bytes"]);

    removeClientStorageKey("dynamic-text");
    removeSessionStorageKey("dynamic-session");

    expect(readClientStorageKey("dynamic-text")).toBeNull();
    expect(readSessionJsonFromKey("dynamic-session")).toBeNull();
  });

  it("contains browser storage API failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable");
    });

    expect(readClientStorageKey("blocked")).toBeNull();
    expect(readSessionJsonFromKey("blocked")).toBeNull();
    expect(() => writeClientStorageKey("blocked", "value")).not.toThrow();
    expect(() => writeSessionJsonToKey("blocked", { value: true })).not.toThrow();
    expect(() => removeClientStorageKey("blocked")).not.toThrow();
    expect(() => removeSessionStorageKey("blocked")).not.toThrow();
  });
});
