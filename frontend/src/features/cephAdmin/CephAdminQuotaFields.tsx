/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiCheckboxClass, uiPanelMutedClass } from "../../components/ui/styles";
import type { CephAdminQuotaUnit } from "./quotaForm";

const QUOTA_UNIT_OPTIONS: CephAdminQuotaUnit[] = ["MiB", "GiB", "TiB"];

type CephAdminQuotaFieldsProps = {
  title: string;
  enabledLabel: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  sizeValue: string;
  onSizeChange: (value: string) => void;
  unitValue: CephAdminQuotaUnit;
  onUnitChange: (unit: CephAdminQuotaUnit) => void;
  objectValue: string;
  onObjectChange: (value: string) => void;
  sizePlaceholder?: string;
  objectPlaceholder?: string;
  className?: string;
};

export default function CephAdminQuotaFields({
  title,
  enabledLabel,
  enabled,
  onEnabledChange,
  sizeValue,
  onSizeChange,
  unitValue,
  onUnitChange,
  objectValue,
  onObjectChange,
  sizePlaceholder,
  objectPlaceholder,
  className,
}: CephAdminQuotaFieldsProps) {
  return (
    <section
      className={cx(
        uiPanelMutedClass,
        "space-y-3 px-4 py-3",
        className
      )}
    >
      <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          className={uiCheckboxClass}
        />
        {enabledLabel}
      </label>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <UiInput
          label="Storage quota"
          type="number"
          min={0}
          step="any"
          disabled={!enabled}
          value={sizeValue}
          onChange={(event) => onSizeChange(event.target.value)}
          placeholder={sizePlaceholder}
          size="compact"
        />
        <UiSelect
          label="Unit"
          disabled={!enabled}
          value={unitValue}
          onChange={(event) => onUnitChange(event.target.value as CephAdminQuotaUnit)}
          size="compact"
        >
          {QUOTA_UNIT_OPTIONS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </UiSelect>
        <UiInput
          label="Object quota"
          type="number"
          min={0}
          step={1}
          disabled={!enabled}
          value={objectValue}
          onChange={(event) => onObjectChange(event.target.value)}
          placeholder={objectPlaceholder}
          size="compact"
        />
      </div>
    </section>
  );
}
