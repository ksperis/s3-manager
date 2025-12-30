/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";
type ThemeSource = "system" | "user";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "theme";

function getPreferredTheme(): { theme: Theme; source: ThemeSource } {
  if (typeof window === "undefined") return { theme: "light", source: "system" };
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark") {
    return { theme: stored, source: "user" };
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return { theme: prefersDark ? "dark" : "light", source: "system" };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preferred = useMemo(() => getPreferredTheme(), []);
  const [theme, setThemeState] = useState<Theme>(preferred.theme);
  const [themeSource, setThemeSource] = useState<ThemeSource>(preferred.source);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    if (themeSource === "user") {
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [theme, themeSource]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (themeSource !== "system") return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handleChange = (event?: MediaQueryListEvent) => {
      const prefersDark = event?.matches ?? media.matches;
      setThemeState(prefersDark ? "dark" : "light");
    };
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [themeSource]);

  const setTheme = (next: Theme) => {
    setThemeSource("user");
    setThemeState(next);
  };
  const toggle = () => {
    setThemeSource("user");
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
