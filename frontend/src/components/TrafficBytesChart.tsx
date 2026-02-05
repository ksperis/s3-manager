/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrafficSeriesPoint, TrafficWindow } from "../api/stats";
import { formatBytes } from "../utils/format";

type ChartPoint = TrafficSeriesPoint & { timestampMs: number };

type TrafficBytesChartProps = {
  window: TrafficWindow;
  series: TrafficSeriesPoint[];
  start?: string | null;
  end?: string | null;
  height?: number;
  chartKey?: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function inferStepMs(windowValue: TrafficWindow, points: ChartPoint[]): number {
  if (points.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const diff = points[i].timestampMs - points[i - 1].timestampMs;
      if (diff > 0) {
        diffs.push(diff);
      }
    }
    if (diffs.length > 0) {
      return Math.min(...diffs);
    }
  }
  return windowValue === "week" ? DAY_MS : HOUR_MS;
}

function normalizeTimestamp(timestamp: number, step: number): number {
  if (step <= 0) {
    return timestamp;
  }
  return Math.floor(timestamp / step) * step;
}

function buildChartData(window: TrafficWindow, series: TrafficSeriesPoint[], start?: string | null, end?: string | null) {
  const raw: ChartPoint[] = (series ?? []).map((point) => ({
    ...point,
    timestampMs: new Date(point.timestamp).getTime(),
  }));
  const sorted = [...raw].sort((a, b) => a.timestampMs - b.timestampMs);

  if (!start || !end) {
    return sorted;
  }

  const step = inferStepMs(window, sorted);
  if (!step) {
    return sorted;
  }

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return sorted;
  }

  const startBoundary = normalizeTimestamp(startMs, step);
  const endBoundary = normalizeTimestamp(endMs, step);
  const entries = new Map<number, ChartPoint>();
  sorted.forEach((point) => {
    const key = normalizeTimestamp(point.timestampMs, step);
    const existing = entries.get(key);
    if (existing) {
      entries.set(key, {
        ...existing,
        bytes_in: existing.bytes_in + point.bytes_in,
        bytes_out: existing.bytes_out + point.bytes_out,
        ops: existing.ops + point.ops,
        success_ops: existing.success_ops + point.success_ops,
      });
    } else {
      entries.set(key, { ...point, timestampMs: key, timestamp: new Date(key).toISOString() });
    }
  });

  const filled: ChartPoint[] = [];
  for (let ts = startBoundary; ts <= endBoundary; ts += step) {
    const existing = entries.get(ts);
    if (existing) {
      filled.push(existing);
    } else {
      filled.push({
        timestamp: new Date(ts).toISOString(),
        timestampMs: ts,
        bytes_in: 0,
        bytes_out: 0,
        ops: 0,
        success_ops: 0,
      });
    }
  }
  return filled;
}

function formatXAxisTimestamp(value: string | number, window: TrafficWindow) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const options =
    window === "week"
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

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

function TrafficTooltip({ payload, label, window }: any) {
  if (!payload || payload.length === 0) {
    return null;
  }
  const date =
    window === "week"
      ? tooltipFormatterDaily.format(new Date(label))
      : tooltipFormatterHourly.format(new Date(label));
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <p className="font-semibold">{date}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="ui-caption">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function TrafficBytesChart({ window, series, start, end, height = 280, chartKey }: TrafficBytesChartProps) {
  const chartData = useMemo(() => buildChartData(window, series, start, end), [end, series, start, window]);
  const domain = useMemo(() => {
    if (!start || !end) {
      return undefined;
    }
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return undefined;
    }
    return [startMs, endMs] as [number, number];
  }, [end, start]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} key={chartKey ?? `${start ?? ""}-${end ?? ""}-${window}`}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis
          dataKey="timestampMs"
          type="number"
          domain={domain ?? ["auto", "auto"]}
          tickFormatter={(value) => formatXAxisTimestamp(value, window)}
          stroke="#94A3B8"
          minTickGap={32}
        />
        <YAxis tickFormatter={(value) => formatBytesAxis(Number(value) || 0)} stroke="#94A3B8" />
        <Tooltip content={<TrafficTooltip window={window} />} />
        <Legend />
        <Bar dataKey="bytes_in" name="Ingress" stackId="traffic" fill="#0EA5E9" />
        <Bar dataKey="bytes_out" name="Egress" stackId="traffic" fill="#4F46E5" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatBytesAxis(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let sized = value;
  while (sized >= 1024 && idx < units.length - 1) {
    sized /= 1024;
    idx += 1;
  }
  const decimals = sized >= 10 ? 0 : 1;
  return `${sized.toFixed(decimals)} ${units[idx]}`;
}

