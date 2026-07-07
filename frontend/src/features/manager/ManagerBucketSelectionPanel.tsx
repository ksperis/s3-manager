/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

import { type Bucket } from "../../api/buckets";
import ListToolbar from "../../components/ListToolbar";
import ManagerTable, { managerTableCheckboxCellClass, managerTablePrimaryCellClass } from "../../components/list/ManagerTable";
import { ListTableStatus } from "../../components/list/listTableStatus";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { uiCheckboxClass } from "../../components/ui/styles";

type ManagerBucketSelectionPanelProps = {
  description: string;
  filter: string;
  filterPlaceholder: string;
  onFilterChange: (filter: string) => void;
  buckets: Bucket[];
  selectedBuckets: Set<string>;
  onToggleBucket: (bucketName: string) => void;
  onSelectFiltered: () => void;
  onClearSelection: () => void;
  action: ReactNode;
  tableStatus: ListTableStatus;
  loadingMessage: string;
  errorMessage: string;
  emptyMessage: string;
};

export default function ManagerBucketSelectionPanel({
  description,
  filter,
  filterPlaceholder,
  onFilterChange,
  buckets,
  selectedBuckets,
  onToggleBucket,
  onSelectFiltered,
  onClearSelection,
  action,
  tableStatus,
  loadingMessage,
  errorMessage,
  emptyMessage,
}: ManagerBucketSelectionPanelProps) {
  return (
    <div className="ui-surface-card">
      <ListToolbar
        title="Buckets"
        description={description}
        showHeading={false}
        countLabel={`${buckets.length} result(s)`}
        search={
          <UiInput
            type="text"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            fieldClassName="w-full sm:w-80"
            size="compact"
          />
        }
        filters={
          <>
            <UiButton
              type="button"
              onClick={onSelectFiltered}
              disabled={buckets.length === 0}
              variant="secondary"
              size="sm"
            >
              Select filtered
            </UiButton>
            <UiButton
              type="button"
              onClick={onClearSelection}
              disabled={selectedBuckets.size === 0}
              variant="secondary"
              size="sm"
            >
              Clear
            </UiButton>
          </>
        }
        actions={action}
      />
      <ManagerTable
        responsiveCards
        columns={[
          { key: "select", label: "Select", className: "w-12", hideLabel: true, mobileLabel: "Select" },
          { key: "bucket", label: "Bucket", mobileRole: "primary" },
        ]}
        listState={{
          status: tableStatus,
          loadingMessage,
          errorMessage,
          emptyMessage,
        }}
      >
        {buckets.map((bucket) => (
          <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <td className={managerTableCheckboxCellClass}>
              <input
                aria-label={`Select ${bucket.name}`}
                type="checkbox"
                checked={selectedBuckets.has(bucket.name)}
                onChange={() => onToggleBucket(bucket.name)}
                className={uiCheckboxClass}
              />
            </td>
            <td className={managerTablePrimaryCellClass}>{bucket.name}</td>
          </tr>
        ))}
      </ManagerTable>
    </div>
  );
}
