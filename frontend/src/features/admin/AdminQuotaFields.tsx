/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { WorkflowSection } from "../../components/WorkflowPage";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";

type AdminQuotaFieldsProps = {
  storageValue: string;
  storageUnit: string;
  objectValue: string;
  disabled: boolean;
  onStorageValueChange: (value: string) => void;
  onStorageUnitChange: (value: string) => void;
  onObjectValueChange: (value: string) => void;
};

export default function AdminQuotaFields({
  storageValue,
  storageUnit,
  objectValue,
  disabled,
  onStorageValueChange,
  onStorageUnitChange,
  onObjectValueChange,
}: AdminQuotaFieldsProps) {
  return (
    <WorkflowSection
      title="Quotas"
      description="Set optional storage and object limits. Leave a value empty to disable that limit."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-2">
          <UiInput
            label="Storage quota"
            type="number"
            min={0}
            step="any"
            value={storageValue}
            disabled={disabled}
            onChange={(event) => onStorageValueChange(event.target.value)}
            placeholder="No limit"
          />
          <UiSelect
            label="Unit"
            aria-label="Storage quota unit"
            value={storageUnit}
            disabled={disabled}
            onChange={(event) => onStorageUnitChange(event.target.value)}
          >
            <option value="MiB">MiB</option>
            <option value="GiB">GiB</option>
            <option value="TiB">TiB</option>
          </UiSelect>
        </div>
        <UiInput
          label="Object quota"
          type="number"
          min={0}
          step={1}
          value={objectValue}
          disabled={disabled}
          onChange={(event) => onObjectValueChange(event.target.value)}
          placeholder="No limit"
        />
      </div>
    </WorkflowSection>
  );
}
