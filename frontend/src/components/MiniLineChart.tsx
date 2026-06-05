/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { cx } from "./ui/styles";

type MiniLineChartProps = {
  values: number[];
  className?: string;
  stroke?: string;
};

export default function MiniLineChart({ values, className, stroke = "#2563eb" }: MiniLineChartProps) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 54 - ((value - min) / range) * 44;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 100 60" className={cx("h-40 w-full overflow-visible", className)}>
      {[0, 1, 2, 3].map((line) => (
        <line key={line} x1="0" x2="100" y1={10 + line * 14} y2={10 + line * 14} stroke="#e5eaf2" strokeWidth="0.8" />
      ))}
      <polyline fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" points={points} />
      {values.map((value, index) => {
        const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
        const y = 54 - ((value - min) / range) * 44;
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="1.7" fill={stroke} />;
      })}
    </svg>
  );
}
