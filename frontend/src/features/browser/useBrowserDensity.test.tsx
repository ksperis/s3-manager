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
        functionalProfile: "advanced",
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

  it("enforces comfortable density for the root Standard profile", () => {
    const { result } = renderHook(() =>
      useBrowserDensity({
        functionalProfile: "standard",
        initialStoredDensity: "compact",
        isMainBrowserPath: true,
      }),
    );

    expect(result.current.canConfigure).toBe(false);
    expect(result.current.compactMode).toBe(false);

    act(() => result.current.setCompactMode(true));

    expect(result.current.compactMode).toBe(false);
    expect(readStoredBrowserRootUiState()).toBeNull();
  });

  it("enforces compact density for the root Portal profile", () => {
    const { result } = renderHook(() =>
      useBrowserDensity({
        functionalProfile: "portal",
        initialStoredDensity: "comfortable",
        isMainBrowserPath: true,
      }),
    );

    expect(result.current.canConfigure).toBe(false);
    expect(result.current.compactMode).toBe(true);
    expect(readStoredBrowserRootUiState()).toBeNull();
  });

  it("keeps embedded surfaces compact unless their contract overrides it", () => {
    const { result, rerender } = renderHook(
      ({ densityOverride }: DensityOverrideProps) =>
        useBrowserDensity({
          densityOverride,
          functionalProfile: "advanced",
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
