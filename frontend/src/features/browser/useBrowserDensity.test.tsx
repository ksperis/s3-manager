import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { BrowserDensity } from "./browserActions";
import { readStoredBrowserRootUiState } from "./browserRootUiState";
import { useBrowserDensity } from "./useBrowserDensity";

type DensityOverrideProps = {
  densityOverride: BrowserDensity | undefined;
};

describe("useBrowserDensity", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores and persists the configurable root Browser density", () => {
    const { result } = renderHook(() =>
      useBrowserDensity({
        initialStoredDensity: "compact",
        isMainBrowserPath: true,
      }),
    );

    expect(result.current.canConfigure).toBe(true);
    expect(result.current.compactMode).toBe(true);
    expect(readStoredBrowserRootUiState()?.density).toBe("compact");

    act(() => result.current.setCompactMode(false));

    expect(result.current.compactMode).toBe(false);
    expect(readStoredBrowserRootUiState()?.density).toBe("comfortable");
  });

  it("defaults the root Browser to compact when no preference exists", () => {
    const { result } = renderHook(() =>
      useBrowserDensity({
        isMainBrowserPath: true,
      }),
    );

    expect(result.current.canConfigure).toBe(true);
    expect(result.current.compactMode).toBe(true);
    expect(readStoredBrowserRootUiState()?.density).toBe("compact");

    act(() => result.current.setCompactMode(false));

    expect(result.current.compactMode).toBe(false);
    expect(readStoredBrowserRootUiState()?.density).toBe("comfortable");
  });

  it("preserves a comfortable root preference independently of profile", () => {
    const { result } = renderHook(() =>
      useBrowserDensity({
        initialStoredDensity: "comfortable",
        isMainBrowserPath: true,
      }),
    );

    expect(result.current.canConfigure).toBe(true);
    expect(result.current.compactMode).toBe(false);
    expect(readStoredBrowserRootUiState()?.density).toBe("comfortable");
  });

  it("keeps embedded surfaces compact unless their contract overrides it", () => {
    const { result, rerender } = renderHook(
      ({ densityOverride }: DensityOverrideProps) =>
        useBrowserDensity({
          densityOverride,
          isMainBrowserPath: false,
        }),
      { initialProps: { densityOverride: undefined } },
    );

    expect(result.current.canConfigure).toBe(false);
    expect(result.current.compactMode).toBe(true);

    rerender({ densityOverride: "comfortable" });

    expect(result.current.compactMode).toBe(false);
    expect(readStoredBrowserRootUiState()).toBeNull();
  });
});
