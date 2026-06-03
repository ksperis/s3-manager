/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */

type DonutChartProps = {
  segments: Array<{ value: number; color: string }>;
  center: string;
  caption: string;
};

export default function DonutChart({ segments, center, caption }: DonutChartProps) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let offset = 25;

  return (
    <div className="relative mx-auto h-44 w-44">
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90">
        <circle cx="22" cy="22" r="16" fill="none" stroke="#e5eaf2" strokeWidth="7" />
        {segments.map((segment, index) => {
          const dash = (segment.value / total) * 100;
          const currentOffset = offset;
          offset -= dash;
          return (
            <circle
              key={`${segment.color}-${index}`}
              cx="22"
              cy="22"
              r="16"
              pathLength={100}
              fill="none"
              stroke={segment.color}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={currentOffset}
              strokeLinecap="butt"
              strokeWidth="7"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-xl font-semibold text-slate-900 dark:text-white">{center}</div>
        <div className="mt-0.5 ui-caption text-slate-500 dark:text-slate-400">{caption}</div>
      </div>
    </div>
  );
}
