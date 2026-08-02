import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerDownload } from "./download";

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
});
