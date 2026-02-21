/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import { UiLanguage, useLanguage } from "./components/language";

export type LocalizedText = {
  en: string;
  fr: string;
  de: string;
};

export function translateText(language: UiLanguage, text: LocalizedText): string {
  return text[language];
}

export function useI18n() {
  const { language } = useLanguage();
  const t = useCallback((text: LocalizedText) => translateText(language, text), [language]);
  return { language, t };
}
