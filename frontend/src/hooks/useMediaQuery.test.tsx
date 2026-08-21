import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("useMediaQuery", () => {
  it("subscribes to modern media-query changes and removes the listener", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const matchMedia = vi.fn((query: string) =>
      ({
        get matches() {
          return matches;
        },
        media: query,
        onchange: null,
        addEventListener: (_event: string, listener: () => void) =>
          listeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          listeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const { result, unmount } = renderHook(() =>
      useMediaQuery("(max-width: 767px)"),
    );
    expect(result.current).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    expect(listeners).toHaveLength(1);

    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(true);

    unmount();
    expect(listeners).toHaveLength(0);
  });

  it("retains the legacy listener fallback in one place", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    const addListener = vi.fn((listener: () => void) =>
      listeners.add(listener),
    );
    const removeListener = vi.fn((listener: () => void) =>
      listeners.delete(listener),
    );
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) =>
        ({
          get matches() {
            return matches;
          },
          media: query,
          onchange: null,
          addListener,
          removeListener,
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    });

    const { result, unmount } = renderHook(() =>
      useMediaQuery("(prefers-color-scheme: dark)"),
    );
    expect(result.current).toBe(true);
    expect(addListener).toHaveBeenCalledOnce();

    matches = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(result.current).toBe(false);

    unmount();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(listeners).toHaveLength(0);
  });

  it("uses the configured snapshot without subscribing when disabled", () => {
    const matchMedia = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const { result } = renderHook(() =>
      useMediaQuery("(max-width: 767px)", {
        defaultMatches: true,
        enabled: false,
      }),
    );

    expect(result.current).toBe(true);
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
