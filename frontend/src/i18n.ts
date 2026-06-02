/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type I18nMessage = string | { en?: string; fr?: string; de?: string };

export function translate(message: I18nMessage): string {
  if (typeof message === "string") return message;
  return message.en ?? message.fr ?? message.de ?? "";
}

export function useI18n() {
  return {
    locale: "en",
    t: translate,
  };
}
