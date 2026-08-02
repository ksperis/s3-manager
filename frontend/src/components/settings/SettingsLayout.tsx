/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormHTMLAttributes, ReactNode } from "react";
import UiBadge from "../ui/UiBadge";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardClass,
  uiCheckboxClass,
  uiDividerClass,
  uiInputClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../ui/styles";
import type { UiTone } from "../ui/styles";

type SettingsSectionProps = {
  title: string;
  description?: string;
  layout?: "grid" | "stack";
  columns?: 1 | 2;
  children: ReactNode;
};

type SettingsItemProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type SettingsSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: boolean) => void;
};

type SettingsConditionalBadgeProps = {
  visible?: boolean;
  label: string;
  tone?: UiTone;
  className?: string;
};

type SettingsToggleActionProps = SettingsSwitchProps & {
  badge?: SettingsConditionalBadgeProps;
  className?: string;
};

type SettingsChoiceRowProps = {
  title: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  children?: ReactNode;
  className?: string;
};

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  padded?: boolean;
};

type SettingsFormCardProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode;
};

export const settingsInputClassName = uiInputClass;
export const settingsTextareaClassName = cx(uiInputClass, "min-h-[96px]");
export const settingsCompactInputClassName = cx(uiInputClass, "ui-caption py-1.5");
export const settingsLabelClassName = cx("ui-caption font-semibold", uiTitleTextClass);
export const settingsHelperClassName = cx("mt-1 ui-caption", uiMutedTextClass);
export const settingsInlineButtonClassName = cx(
  uiButtonBaseClass,
  uiButtonVariants.secondary,
  "h-7 px-2.5 py-1 ui-caption"
);
export const settingsPrimaryActionButtonClassName = cx(
  uiButtonBaseClass,
  uiButtonVariants.primary,
  "h-8 px-4 py-2 ui-caption"
);

export function SettingsCard({ children, className, padded = true }: SettingsCardProps) {
  return <section className={cx(uiCardClass, padded && "p-4 sm:p-5", className)}>{children}</section>;
}

export function SettingsFormCard({ children, className, ...props }: SettingsFormCardProps) {
  return (
    <form className={cx(uiCardClass, "p-4 sm:p-5", className)} {...props}>
      {children}
    </form>
  );
}

export const SettingsSection = ({
  title,
  description,
  layout = "grid",
  columns = 2,
  children,
}: SettingsSectionProps) => {
  const layoutClass = cx(
    "mt-3 grid",
    layout === "grid" &&
      columns === 2 &&
      "gap-x-6 md:grid-cols-2 md:[&>*:nth-child(2)]:border-t-0 md:[&>*:nth-child(2)]:pt-0"
  );

  return (
    <div>
      <p className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>{title}</p>
      {description && <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p>}
      <div className={layoutClass}>{children}</div>
    </div>
  );
};

export const SettingsItem = ({ title, description, action, children, className }: SettingsItemProps) => (
  <div
    className={cx(
      "border-t py-3 text-[var(--ui-text)] first:border-t-0 first:pt-0 last:pb-0",
      uiDividerClass,
      className
    )}
  >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className={cx("ui-body font-semibold", uiTitleTextClass)}>{title}</p>
        {description && <p className={cx("ui-caption", uiMutedTextClass)}>{description}</p>}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    {children}
  </div>
);

export const SettingsChoiceRow = ({
  title,
  description,
  checked,
  disabled,
  onChange,
  children,
  className,
}: SettingsChoiceRowProps) => (
  <label
    className={cx(
      "flex items-start gap-3 border-t py-3 ui-caption first:border-t-0 first:pt-0 last:pb-0",
      uiDividerClass,
      disabled ? "cursor-not-allowed text-[var(--ui-text-muted)] opacity-70" : "cursor-pointer text-[var(--ui-text)]",
      className
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={`mt-0.5 ${settingsCheckboxClassName}`}
    />
    <span className="min-w-0 flex-1">
      <span className={cx("block font-semibold", disabled ? uiMutedTextClass : uiTitleTextClass)}>{title}</span>
      {description && <span className="block text-[var(--ui-text-muted)]">{description}</span>}
      {children}
    </span>
  </label>
);

export const SettingsSwitch = ({ checked, disabled, ariaLabel, onChange }: SettingsSwitchProps) => (
  <label className={`relative inline-flex items-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
    <input
      type="checkbox"
      className="peer sr-only"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
    <span className="h-5 w-9 rounded-full bg-[var(--ui-border)] transition peer-checked:bg-emerald-500" />
    <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
  </label>
);

export const SettingsConditionalBadge = ({
  visible = false,
  label,
  tone = "warning",
  className,
}: SettingsConditionalBadgeProps) => {
  if (!visible) return null;
  return (
    <UiBadge tone={tone} className={className}>
      {label}
    </UiBadge>
  );
};

export const SettingsToggleAction = ({
  checked,
  disabled,
  ariaLabel,
  onChange,
  badge,
  className,
}: SettingsToggleActionProps) => (
  <div className={cx("inline-flex items-center gap-2", className)}>
    {badge && (
      <SettingsConditionalBadge
        visible={badge.visible}
        label={badge.label}
        tone={badge.tone}
        className={badge.className}
      />
    )}
    <SettingsSwitch checked={checked} disabled={disabled} ariaLabel={ariaLabel} onChange={onChange} />
  </div>
);

export const settingsCheckboxClassName = uiCheckboxClass;
