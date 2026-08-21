import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_STORAGE_KEYS } from "../utils/clientStorage";
import { ThemeProvider, useTheme } from "./theme";

const originalMatchMedia = window.matchMedia;

function ThemeProbe() {
  const { setTheme, theme, toggle } = useTheme();
  return (
    <div>
      <span>{theme}</span>
      <button type="button" onClick={() => setTheme("light")}>
        Set light
      </button>
      <button type="button" onClick={toggle}>
        Toggle
      </button>
    </div>
  );
}

function installSystemTheme(initialMatches = false) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) =>
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
  });
  return {
    listeners,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
    document.documentElement.classList.remove("dark");
  });

  it("follows the system theme until the user chooses an explicit theme", () => {
    const systemTheme = installSystemTheme();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText("light")).toBeInTheDocument();
    expect(systemTheme.listeners.size).toBe(1);

    systemTheme.setMatches(true);
    expect(screen.getByText("dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");

    fireEvent.click(screen.getByRole("button", { name: "Set light" }));
    expect(screen.getByText("light")).toBeInTheDocument();
    expect(systemTheme.listeners.size).toBe(0);
    expect(window.localStorage.getItem(CLIENT_STORAGE_KEYS.theme)).toBe(
      "light",
    );

    systemTheme.setMatches(false);
    systemTheme.setMatches(true);
    expect(screen.getByText("light")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByText("dark")).toBeInTheDocument();
    expect(window.localStorage.getItem(CLIENT_STORAGE_KEYS.theme)).toBe(
      "dark",
    );
  });

  it("uses a stored user theme without subscribing to system changes", () => {
    window.localStorage.setItem(CLIENT_STORAGE_KEYS.theme, "dark");
    const systemTheme = installSystemTheme(false);

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText("dark")).toBeInTheDocument();
    expect(systemTheme.listeners.size).toBe(0);
  });
});
