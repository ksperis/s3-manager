import { describe, expect, it, vi } from "vitest";
import { runBrowserScopedSave } from "./browserScopedSave";

describe("runBrowserScopedSave", () => {
  it("toggles saving state around a successful current operation", async () => {
    const setSaving = vi.fn();

    await expect(
      runBrowserScopedSave(() => true, setSaving, async () => "saved"),
    ).resolves.toBe("saved");
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("discards a result when its scope changes during the operation", async () => {
    let current = true;
    const setSaving = vi.fn();

    await expect(
      runBrowserScopedSave(
        () => current,
        setSaving,
        async () => {
          current = false;
          return "stale";
        },
      ),
    ).resolves.toBeNull();
    expect(setSaving).toHaveBeenCalledOnce();
    expect(setSaving).toHaveBeenCalledWith(true);
  });

  it("rethrows a current operation error and clears saving state", async () => {
    const setSaving = vi.fn();
    const failure = new Error("save failed");

    await expect(
      runBrowserScopedSave(() => true, setSaving, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });
});
