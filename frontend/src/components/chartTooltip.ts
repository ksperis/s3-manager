/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type ChartTooltipValue = number | string | ReadonlyArray<number | string>;

export type ChartTooltipEntry<TPayload = unknown> = {
  color?: string;
  dataKey?: number | string;
  name?: number | string;
  payload?: TPayload;
  value?: ChartTooltipValue;
};

export type ChartTooltipProps<TPayload = unknown> = {
  active?: boolean;
  label?: number | string;
  payload?: ReadonlyArray<ChartTooltipEntry<TPayload>>;
};

const tooltipFormatterHourly = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const tooltipFormatterDaily = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

export function formatChartTooltipTimestamp(
  label: number | string | undefined,
  granularity: "hourly" | "daily",
): string {
  if (label === undefined) return "";
  const date = new Date(label);
  if (Number.isNaN(date.getTime())) return String(label);
  return granularity === "daily" ? tooltipFormatterDaily.format(date) : tooltipFormatterHourly.format(date);
}
