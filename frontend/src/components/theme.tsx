/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CLIENT_STORAGE_KEYS, readClientStorage, removeClientStorage, writeClientStorage } from "../utils/clientStorage";
import { readStoredUser } from "../utils/workspaces";

type Theme = "light" | "dark";
type ThemeSource = "system" | "user";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = CLIENT_STORAGE_KEYS.theme;

function getPreferredTheme(): { theme: Theme; source: ThemeSource } {
  if (typeof window === "undefined") return { theme: "light", source: "system" };
  const stored = readClientStorage(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark") {
    return { theme: stored, source: "user" };
  }
  const parsedUser = readStoredUser();
  if (parsedUser) {
    const preferred = parsedUser.ui_preferences?.theme;
    if (preferred === "light" || preferred === "dark") {
      return { theme: preferred, source: "user" };
    }
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
      writeClientStorage(STORAGE_KEY, theme);
    } else {
      removeClientStorage(STORAGE_KEY);
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

  const setTheme = useCallback((next: Theme) => {
    setThemeSource("user");
    setThemeState(next);
  }, []);
  const toggle = useCallback(() => {
    setThemeSource("user");
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
