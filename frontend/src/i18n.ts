/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback } from "react";
import { useOptionalLanguage, type UiLanguage } from "./components/language";

export type I18nMessage = string | { en?: string; fr?: string; de?: string };

export function translate(message: I18nMessage, locale: UiLanguage = "en"): string {
  if (typeof message === "string") return message;
  return message[locale] ?? message.en ?? message.fr ?? message.de ?? "";
}

export function useI18n() {
  const languageContext = useOptionalLanguage();
  const locale = languageContext?.language ?? "en";
  const t = useCallback((message: I18nMessage) => translate(message, locale), [locale]);

  return {
    locale,
    t,
  };
}
