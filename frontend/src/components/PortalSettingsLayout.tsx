/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";
import UiBadge from "./ui/UiBadge";
import type { UiTone } from "./ui/styles";

type PortalSettingsSectionProps = {
  title: string;
  description?: string;
  layout?: "grid" | "stack";
  columns?: 1 | 2;
  children: ReactNode;
};

type PortalSettingsItemProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type PortalSettingsSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: boolean) => void;
};

type PortalSettingsConditionalBadgeProps = {
  visible?: boolean;
  label: string;
  tone?: UiTone;
  className?: string;
};

type PortalSettingsToggleActionProps = PortalSettingsSwitchProps & {
  badge?: PortalSettingsConditionalBadgeProps;
  className?: string;
};

export const PortalSettingsSection = ({
  title,
  description,
  layout = "grid",
  columns = 2,
  children,
}: PortalSettingsSectionProps) => {
  const layoutClass =
    layout === "grid" ? `mt-2 grid gap-3 ${columns === 2 ? "md:grid-cols-2" : ""}` : "mt-2 space-y-3";

  return (
    <div>
      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {description && <p className="ui-caption text-slate-500 dark:text-slate-400">{description}</p>}
      <div className={layoutClass}>{children}</div>
    </div>
  );
};

export const PortalSettingsItem = ({ title, description, action, children, className }: PortalSettingsItemProps) => (
  <div className={`rounded-lg border border-slate-200/80 p-3 dark:border-slate-700 ${className ?? ""}`.trim()}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        {description && <p className="ui-caption text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

export const PortalSettingsSwitch = ({ checked, disabled, ariaLabel, onChange }: PortalSettingsSwitchProps) => (
  <label className={`relative inline-flex items-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
    <input
      type="checkbox"
      className="peer sr-only"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
    <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-emerald-500 dark:bg-slate-700" />
    <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
  </label>
);

export const PortalSettingsConditionalBadge = ({
  visible = false,
  label,
  tone = "warning",
  className,
}: PortalSettingsConditionalBadgeProps) => {
  if (!visible) return null;
  return (
    <UiBadge tone={tone} className={className}>
      {label}
    </UiBadge>
  );
};

export const PortalSettingsToggleAction = ({
  checked,
  disabled,
  ariaLabel,
  onChange,
  badge,
  className,
}: PortalSettingsToggleActionProps) => (
  <div className={`inline-flex items-center gap-2 ${className ?? ""}`.trim()}>
    {badge && (
      <PortalSettingsConditionalBadge
        visible={badge.visible}
        label={badge.label}
        tone={badge.tone}
        className={badge.className}
      />
    )}
    <PortalSettingsSwitch checked={checked} disabled={disabled} ariaLabel={ariaLabel} onChange={onChange} />
  </div>
);
