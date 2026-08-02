/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type ReactNode, useId } from "react";

import PageTabs, { PageTabPanel } from "./PageTabs";

type WorkflowTab<T extends string> = {
  id: T;
  label: string;
  visible?: boolean;
  disabled?: boolean;
};

type WorkflowTabsProps<T extends string> = {
  activeTab: T;
  onTabChange: (tab: T) => void;
  tabs: WorkflowTab<T>[];
  ariaLabel: string;
  children: ReactNode;
  idPrefix?: string;
  panelClassName?: string;
};

/**
 * Shared tab shell for page-sized configuration workflows. It owns the
 * navigation baseline and tab/panel relationship so workspaces cannot drift
 * back to locally framed or visually detached tab bars.
 */
export default function WorkflowTabs<T extends string>({
  activeTab,
  onTabChange,
  tabs,
  ariaLabel,
  children,
  idPrefix,
  panelClassName = "mt-4 min-w-0 space-y-4",
}: WorkflowTabsProps<T>) {
  const generatedId = useId().replaceAll(":", "");
  const resolvedIdPrefix = idPrefix ?? `workflow-tabs-${generatedId}`;

  return (
    <div className="min-w-0">
      <PageTabs
        tabs={tabs.filter((tab) => tab.visible !== false)}
        activeTab={activeTab}
        onChange={(tab) => onTabChange(tab as T)}
        variant="line"
        ariaLabel={ariaLabel}
        idPrefix={resolvedIdPrefix}
      />
      <PageTabPanel
        idPrefix={resolvedIdPrefix}
        tabId={activeTab}
        className={panelClassName}
      >
        {children}
      </PageTabPanel>
    </div>
  );
}
