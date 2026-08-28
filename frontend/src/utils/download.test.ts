import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDownloadTimestamp,
  triggerDownload,
  triggerJsonDownload,
} from "./download";

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  window.URL,
  "createObjectURL",
);
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  window.URL,
  "revokeObjectURL",
);

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) {
    Object.defineProperty(window.URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(window.URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(window.URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    Reflect.deleteProperty(window.URL, "revokeObjectURL");
  }
});

describe("triggerDownload", () => {
  it("formats stable filename timestamps from dates or ISO strings", () => {
    const date = new Date("2026-08-28T12:34:56.789Z");

    expect(formatDownloadTimestamp(date)).toBe("2026-08-28T12-34-56-789Z");
    expect(formatDownloadTimestamp(date.toISOString())).toBe(
      "2026-08-28T12-34-56-789Z",
    );
  });

  it("downloads text through a temporary object URL and cleans it up", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(window.URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    triggerDownload("report.csv", "a,b", "text/csv");

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/csv" }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
  });

  it("downloads JSON with the canonical serialization and MIME type", async () => {
    const createObjectURL = vi.fn(() => "blob:json");
    Object.defineProperties(window.URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    triggerJsonDownload("report.json", { answer: 42 });

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/json");
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(content).toBe('{\n  "answer": 42\n}');
  });
});
