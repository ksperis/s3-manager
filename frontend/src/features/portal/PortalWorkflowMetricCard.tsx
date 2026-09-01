/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import UiCard from "../../components/ui/UiCard";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";

type PortalWorkflowMetricCardProps = {
  label: string;
  value: string;
  detail: string;
};

export default function PortalWorkflowMetricCard({
  label,
  value,
  detail,
}: PortalWorkflowMetricCardProps) {
  return (
    <UiCard bodyClassName="px-4 py-3">
      <div className={cx("text-[11px] font-semibold", uiMutedTextClass)}>
        {label}
      </div>
      <div className={cx("mt-2 text-[20px] font-bold leading-6", uiTitleTextClass)}>
        {value}
      </div>
      <div className={cx("mt-1 text-[11px] font-medium", uiMutedTextClass)}>
        {detail}
      </div>
    </UiCard>
  );
}
