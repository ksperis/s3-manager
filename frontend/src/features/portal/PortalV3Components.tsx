/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx, uiInputClass } from "../../components/ui/styles";

type PortalV3HeaderAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
};

export function PortalV3Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1360px] space-y-5 px-5 py-5">{children}</div>;
}

export function PortalV3PageHeader({
  title,
  description,
  actions = [],
  right,
}: {
  title: string;
  description?: string;
  actions?: PortalV3HeaderAction[];
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[17px] font-bold leading-6 text-slate-950">{title}</h1>
        {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {right}
        {actions.map((action) => {
          const className = cx(
            "inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-bold shadow-sm transition",
            action.variant === "secondary"
              ? "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
              : "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
          );
          if (action.to) {
            return (
              <Link key={action.label} to={action.to} className={className}>
                {action.label}
              </Link>
            );
          }
          return (
            <button key={action.label} type="button" onClick={action.onClick} className={className}>
              {action.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}

export function PortalV3Card({
  title,
  description,
  children,
  action,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("portal-v3-card overflow-hidden", className)}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[13px] font-bold leading-5 text-slate-950">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PortalV3MetricCard({
  label,
  value,
  delta,
  tone = "blue",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "blue" | "green" | "amber" | "rose";
}) {
  const toneClasses = {
    blue: "text-blue-600 bg-blue-50 border-blue-100",
    green: "text-emerald-600 bg-emerald-50 border-emerald-100",
    amber: "text-amber-600 bg-amber-50 border-amber-100",
    rose: "text-rose-600 bg-rose-50 border-rose-100",
  };
  return (
    <div className="portal-v3-card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={cx("h-2 w-2 rounded-full border", toneClasses[tone])} />
        <span className="text-[11px] font-bold text-slate-500">{label}</span>
      </div>
      <div className="mt-3 text-[20px] font-bold leading-6 text-slate-950">{value}</div>
      {delta ? <div className="mt-1 text-[11px] font-semibold text-emerald-600">{delta}</div> : null}
    </div>
  );
}

export function PortalV3Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "rose";
}) {
  const classes = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    green: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
  };
  return <span className={cx("inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold", classes[tone])}>{children}</span>;
}

export function PortalV3Progress({ value, color = "bg-blue-600" }: { value: number; color?: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 rounded-full bg-slate-100">
      <div className={cx("h-full rounded-full", color)} style={{ width: `${width}%` }} />
    </div>
  );
}

export function PortalV3Search({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cx(uiInputClass, "h-8 rounded-md py-1.5 text-xs", className)}
    />
  );
}

export function PortalV3MiniLineChart({ values }: { values: number[] }) {
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
    <svg viewBox="0 0 100 60" className="h-40 w-full overflow-visible">
      {[0, 1, 2, 3].map((line) => (
        <line key={line} x1="0" x2="100" y1={10 + line * 14} y2={10 + line * 14} stroke="#e5eaf2" strokeWidth="0.8" />
      ))}
      <polyline fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" points={points} />
      {values.map((value, index) => {
        const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
        const y = 54 - ((value - min) / range) * 44;
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="1.7" fill="#2563eb" />;
      })}
    </svg>
  );
}

export function PortalV3Donut({
  segments,
  center,
  caption,
}: {
  segments: Array<{ value: number; color: string }>;
  center: string;
  caption: string;
}) {
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
        <div className="text-xl font-bold text-slate-950">{center}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">{caption}</div>
      </div>
    </div>
  );
}

export function PortalV3Link({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-xs font-bold text-blue-600 hover:text-blue-700">
      {children}
    </Link>
  );
}
