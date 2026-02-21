/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type UiLanguage = "en" | "fr" | "de";
export type UiLanguagePreference = UiLanguage | "auto";

type LanguageContextValue = {
  language: UiLanguage;
  languagePreference: UiLanguagePreference;
  setLanguage: (language: UiLanguage) => void;
  setLanguagePreference: (preference: UiLanguagePreference) => void;
};

type StoredUserLanguage = {
  ui_language?: string | null;
};

const SUPPORTED_LANGUAGES: UiLanguage[] = ["en", "fr", "de"];

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function parseStoredUserLanguage(): UiLanguagePreference {
  if (typeof window === "undefined") return "auto";
  const raw = localStorage.getItem("user");
  if (!raw) return "auto";
  try {
    const parsed = JSON.parse(raw) as StoredUserLanguage;
    const lang = parsed.ui_language;
    if (lang === "en" || lang === "fr" || lang === "de") {
      return lang;
    }
  } catch {
    return "auto";
  }
  return "auto";
}

function detectBrowserLanguage(): UiLanguage {
  if (typeof window === "undefined") return "en";
  const candidates = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").toLowerCase();
    const base = normalized.split("-")[0];
    if (SUPPORTED_LANGUAGES.includes(base as UiLanguage)) {
      return base as UiLanguage;
    }
  }
  return "en";
}

function resolveLanguage(preference: UiLanguagePreference): UiLanguage {
  if (preference === "auto") {
    return detectBrowserLanguage();
  }
  return preference;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [languagePreference, setLanguagePreferenceState] = useState<UiLanguagePreference>(parseStoredUserLanguage);
  const [language, setLanguageState] = useState<UiLanguage>(() => resolveLanguage(parseStoredUserLanguage()));

  useEffect(() => {
    setLanguageState(resolveLanguage(languagePreference));
  }, [languagePreference]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "user") return;
      setLanguagePreferenceState(parseStoredUserLanguage());
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguagePreferenceState(next);
  }, []);

  const setLanguagePreference = useCallback((next: UiLanguagePreference) => {
    setLanguagePreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ language, languagePreference, setLanguage, setLanguagePreference }),
    [language, languagePreference, setLanguage, setLanguagePreference]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
