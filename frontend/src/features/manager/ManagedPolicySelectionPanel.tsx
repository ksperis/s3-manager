/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";

import type { IamPolicy } from "../../api/managerIamPolicies";
import UiCheckboxField from "../../components/ui/UiCheckboxField";

type ManagedPolicySelectionPanelProps = {
  title: string;
  description: string;
  emptyMessage: string;
  footer: string;
  policies: IamPolicy[];
  selectedPolicyArns: string[];
  search: string;
  expanded: boolean;
  onSearchChange: (value: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onSelectionChange: (policyArns: string[]) => void;
};

export default function ManagedPolicySelectionPanel({
  title,
  description,
  emptyMessage,
  footer,
  policies,
  selectedPolicyArns,
  search,
  expanded,
  onSearchChange,
  onExpandedChange,
  onSelectionChange,
}: ManagedPolicySelectionPanelProps) {
  const filteredPolicies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return policies;
    return policies.filter((policy) =>
      [policy.name, policy.arn].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [policies, search]);

  const updateSelection = (policyArn: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedPolicyArns, policyArn]);
      return;
    }
    onSelectionChange(selectedPolicyArns.filter((arn) => arn !== policyArn));
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-[color:var(--ui-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </div>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedPolicyArns.length > 0 && (
            <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {selectedPolicyArns.length} selected
            </span>
          )}
          <button
            type="button"
            onClick={() => onExpandedChange(!expanded)}
            className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
          >
            {expanded ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {expanded && (
        <>
          {policies.length === 0 ? (
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {emptyMessage}
            </p>
          ) : (
            <>
              <input
                type="text"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search policies by name or ARN"
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <div className="flex flex-wrap gap-2">
                {filteredPolicies.length === 0 && (
                  <span className="ui-caption text-slate-500 dark:text-slate-400">
                    No matching policies.
                  </span>
                )}
                {filteredPolicies.map((policy) => (
                  <UiCheckboxField
                    key={policy.arn}
                    checked={selectedPolicyArns.includes(policy.arn)}
                    onChange={(event) =>
                      updateSelection(policy.arn, event.target.checked)
                    }
                    className="rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    labelProps={{ title: policy.arn }}
                  >
                    <span>{policy.name}</span>
                  </UiCheckboxField>
                ))}
              </div>
            </>
          )}
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {footer}
          </p>
        </>
      )}
    </div>
  );
}
