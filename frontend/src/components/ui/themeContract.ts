/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type AppThemeTokens = {
  bg: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryStrong: string;
  success: string;
  warning: string;
  danger: string;
};

export const defaultLightThemeTokens: AppThemeTokens = {
  bg: "#f8fafc",
  surface: "#ffffff",
  surfaceMuted: "#f1f5f9",
  surfaceElevated: "#ffffff",
  border: "#cbd5e1",
  text: "#0f172a",
  textMuted: "#475569",
  primary: "#0ea5e9",
  primaryStrong: "#0284c7",
  success: "#059669",
  warning: "#d97706",
  danger: "#e11d48",
};

export const defaultDarkThemeTokens: AppThemeTokens = {
  bg: "#0b1220",
  surface: "#0f172a",
  surfaceMuted: "#111827",
  surfaceElevated: "#0b1220",
  border: "#334155",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  primary: "#38bdf8",
  primaryStrong: "#0ea5e9",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
};

