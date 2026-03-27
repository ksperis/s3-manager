/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { TagColorKey } from "../api/tags";

export type TagColorOption = {
  key: TagColorKey;
  label: string;
  badgeClassName: string;
  swatchClassName: string;
};

export const TAG_COLOR_OPTIONS: TagColorOption[] = [
  {
    key: "neutral",
    label: "Neutral",
    badgeClassName:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
    swatchClassName: "bg-slate-400",
  },
  {
    key: "slate",
    label: "Slate",
    badgeClassName:
      "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
    swatchClassName: "bg-slate-500",
  },
  {
    key: "gray",
    label: "Gray",
    badgeClassName:
      "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100",
    swatchClassName: "bg-gray-500",
  },
  {
    key: "zinc",
    label: "Zinc",
    badgeClassName:
      "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100",
    swatchClassName: "bg-zinc-500",
  },
  {
    key: "stone",
    label: "Stone",
    badgeClassName:
      "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100",
    swatchClassName: "bg-stone-500",
  },
  {
    key: "red",
    label: "Red",
    badgeClassName:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100",
    swatchClassName: "bg-red-500",
  },
  {
    key: "orange",
    label: "Orange",
    badgeClassName:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/40 dark:text-orange-100",
    swatchClassName: "bg-orange-500",
  },
  {
    key: "amber",
    label: "Amber",
    badgeClassName:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100",
    swatchClassName: "bg-amber-500",
  },
  {
    key: "yellow",
    label: "Yellow",
    badgeClassName:
      "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/40 dark:bg-yellow-950/40 dark:text-yellow-100",
    swatchClassName: "bg-yellow-400",
  },
  {
    key: "lime",
    label: "Lime",
    badgeClassName:
      "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900/40 dark:bg-lime-950/40 dark:text-lime-100",
    swatchClassName: "bg-lime-500",
  },
  {
    key: "green",
    label: "Green",
    badgeClassName:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/40 dark:text-green-100",
    swatchClassName: "bg-green-500",
  },
  {
    key: "emerald",
    label: "Emerald",
    badgeClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100",
    swatchClassName: "bg-emerald-500",
  },
  {
    key: "teal",
    label: "Teal",
    badgeClassName:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/40 dark:bg-teal-950/40 dark:text-teal-100",
    swatchClassName: "bg-teal-500",
  },
  {
    key: "cyan",
    label: "Cyan",
    badgeClassName:
      "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/40 dark:bg-cyan-950/40 dark:text-cyan-100",
    swatchClassName: "bg-cyan-500",
  },
  {
    key: "sky",
    label: "Sky",
    badgeClassName:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100",
    swatchClassName: "bg-sky-500",
  },
  {
    key: "blue",
    label: "Blue",
    badgeClassName:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100",
    swatchClassName: "bg-blue-500",
  },
  {
    key: "indigo",
    label: "Indigo",
    badgeClassName:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-100",
    swatchClassName: "bg-indigo-500",
  },
  {
    key: "violet",
    label: "Violet",
    badgeClassName:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-100",
    swatchClassName: "bg-violet-500",
  },
  {
    key: "purple",
    label: "Purple",
    badgeClassName:
      "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/40 dark:bg-purple-950/40 dark:text-purple-100",
    swatchClassName: "bg-purple-500",
  },
  {
    key: "fuchsia",
    label: "Fuchsia",
    badgeClassName:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/40 dark:text-fuchsia-100",
    swatchClassName: "bg-fuchsia-500",
  },
  {
    key: "pink",
    label: "Pink",
    badgeClassName:
      "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900/40 dark:bg-pink-950/40 dark:text-pink-100",
    swatchClassName: "bg-pink-500",
  },
  {
    key: "rose",
    label: "Rose",
    badgeClassName:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100",
    swatchClassName: "bg-rose-500",
  },
];

export function getTagColorOption(colorKey?: string | null): TagColorOption {
  return TAG_COLOR_OPTIONS.find((option) => option.key === colorKey) ?? TAG_COLOR_OPTIONS[0];
}
