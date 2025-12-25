/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { formatPercentage } from "../utils/format";

export type UsageTileProps = {
  label: string;
  used?: number | null;
  quota?: number | null;
  formatter: (value?: number | null) => string;
  quotaFormatter?: (value?: number | null) => string;
  loading?: boolean;
  unitHint?: string;
  emptyHint?: string;
};

export default function UsageTile({
  label,
  used,
  quota,
  formatter,
  quotaFormatter,
  loading,
  unitHint,
  emptyHint,
}: UsageTileProps) {
  const hasUsage = typeof used === "number" && !Number.isNaN(used);
  const ratio = quota && quota > 0 && hasUsage ? Math.min(100, (used / quota) * 100) : null;
  const usedDisplay = hasUsage ? formatter(used) : loading ? "Loading..." : "—";
  const quotaDisplay = quota && quota > 0 ? (quotaFormatter ? quotaFormatter(quota) : formatter(quota)) : null;
  const ratioLabel = ratio !== null ? formatPercentage(ratio) : "—";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <div className="shrink-0">
          {ratio === null ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-slate-200 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
              N/A
            </div>
          ) : (
            <UsageGauge ratio={ratio} />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
          <p className="text-xl font-semibold text-slate-900 dark:text-white">
            {usedDisplay}
            {unitHint && hasUsage && <span className="ml-1 text-[11px] font-normal text-slate-500 dark:text-slate-400">{unitHint}</span>}
          </p>
          {quotaDisplay ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {usedDisplay} / {quotaDisplay} · {ratioLabel}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{emptyHint ?? "No quota defined."}</p>
          )}
        </div>
      </div>
      <div className="h-1 rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${getBarColor(ratio ?? 0)}`}
          style={{ width: `${ratio ?? 0}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function UsageGauge({ ratio }: { ratio: number }) {
  const clamped = Math.min(100, Math.max(0, ratio));
  const angle = (clamped / 100) * 360;
  const color = getAccentColor(clamped);
  const track = "rgba(148, 163, 184, 0.25)";

  return (
    <div
      className="relative h-16 w-16 rounded-full"
      role="img"
      aria-label={`Usage at ${formatPercentage(clamped)}`}
      style={{
        background: `conic-gradient(${color} ${angle}deg, ${track} ${angle}deg 360deg)`,
      }}
    >
      <div className="absolute inset-1.5 flex items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        {formatPercentage(clamped)}
      </div>
    </div>
  );
}

function getAccentColor(ratio: number) {
  if (ratio >= 90) return "#f43f5e";
  if (ratio >= 75) return "#f97316";
  return "#0ea5e9";
}

function getBarColor(ratio: number) {
  if (ratio >= 90) return "bg-rose-500";
  if (ratio >= 75) return "bg-amber-500";
  return "bg-primary";
}
