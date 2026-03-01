/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fetchBrandingSettings } from "../../api/appSettings";

const PRIMARY_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const LIGHTNESS_OFFSETS_LIGHT = [42, 36, 26, 16, 8, 0, -8, -16, -24, -32, -38] as const;
const LIGHTNESS_OFFSETS_DARK = [30, 24, 16, 8, 2, -4, -10, -16, -24, -30, -36] as const;
const SATURATION_OFFSETS = [-22, -18, -12, -8, -4, 0, 2, 4, 6, 8, 10] as const;
const BRANDING_STORAGE_KEY = "branding.primary_color";
const DEFAULT_PRIMARY_COLOR = "#0ea5e9";

type ThemeMode = "light" | "dark";
type PrimaryShade = (typeof PRIMARY_SHADES)[number];
type PrimaryScale = Record<PrimaryShade, string>;
type Hsl = { h: number; s: number; l: number };
type Rgb = { r: number; g: number; b: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}

function hexToRgb(hex: string): Rgb {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === nr) {
      hue = ((ng - nb) / delta) % 6;
    } else if (max === ng) {
      hue = (nb - nr) / delta + 2;
    } else {
      hue = (nr - ng) / delta + 4;
    }
  }

  const h = (hue * 60 + 360) % 360;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const normalizedS = clamp(s, 0, 100) / 100;
  const normalizedL = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * normalizedL - 1)) * normalizedS;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = normalizedL - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

function rgbToCssValue({ r, g, b }: Rgb): string {
  return `${r} ${g} ${b}`;
}

function applyScaleToRoot(root: HTMLElement, mode: ThemeMode, scale: PrimaryScale): void {
  for (const shade of PRIMARY_SHADES) {
    root.style.setProperty(`--ui-primary-${mode}-${shade}-rgb`, scale[shade]);
  }
}

export function isValidHexColor(value: string | null | undefined): value is string {
  return normalizeHexColor(value) !== null;
}

export function generatePrimaryScale(primaryColor: string, mode: ThemeMode): PrimaryScale {
  const normalized = normalizeHexColor(primaryColor);
  if (!normalized) {
    throw new Error("primaryColor must be in #rrggbb format");
  }
  const baseHsl = rgbToHsl(hexToRgb(normalized));
  const lightnessOffsets = mode === "dark" ? LIGHTNESS_OFFSETS_DARK : LIGHTNESS_OFFSETS_LIGHT;
  const scale = {} as PrimaryScale;

  PRIMARY_SHADES.forEach((shade, index) => {
    const nextS = clamp(baseHsl.s + SATURATION_OFFSETS[index], 12, 96);
    const nextL = clamp(baseHsl.l + lightnessOffsets[index], 6, 96);
    scale[shade] = rgbToCssValue(hslToRgb({ h: baseHsl.h, s: nextS, l: nextL }));
  });
  return scale;
}

export function applyBranding(primaryColor: string): boolean {
  if (typeof document === "undefined") return false;
  const normalized = normalizeHexColor(primaryColor);
  if (!normalized) return false;

  const root = document.documentElement;
  const lightScale = generatePrimaryScale(normalized, "light");
  const darkScale = generatePrimaryScale(normalized, "dark");
  applyScaleToRoot(root, "light", lightScale);
  applyScaleToRoot(root, "dark", darkScale);

  if (typeof window !== "undefined") {
    localStorage.setItem(BRANDING_STORAGE_KEY, normalized);
  }
  return true;
}

export async function bootstrapBranding(): Promise<void> {
  const storedColor = typeof window !== "undefined" ? localStorage.getItem(BRANDING_STORAGE_KEY) : null;
  if (storedColor && !applyBranding(storedColor) && typeof window !== "undefined") {
    localStorage.removeItem(BRANDING_STORAGE_KEY);
  }

  try {
    const branding = await fetchBrandingSettings();
    if (!applyBranding(branding.primary_color)) {
      applyBranding(DEFAULT_PRIMARY_COLOR);
    }
  } catch (error) {
    if (storedColor) return;
    applyBranding(DEFAULT_PRIMARY_COLOR);
    console.warn("Unable to load branding settings, keeping default accent color.", error);
  }
}

