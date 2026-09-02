/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ReactNode } from "react";

import { type Bucket } from "../../api/buckets";
import ListToolbar from "../../components/ListToolbar";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { ListTableStatus } from "../../components/list/listTableStatus";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { uiCheckboxClass } from "../../components/ui/styles";

type ManagerBucketSelectionPanelProps = {
  className?: string;
  countLabel?: ReactNode;
  description: string;
  filter: string;
  filterPlaceholder: string;
  onFilterChange: (filter: string) => void;
  buckets: Bucket[];
  selectedBuckets: Set<string>;
  onToggleBucket: (bucketName: string) => void;
  onSelectFiltered: () => void;
  onClearSelection: () => void;
  action?: ReactNode;
  tableStatus: ListTableStatus;
  loadingMessage: string;
  errorMessage: string;
  emptyMessage: string;
};

export default function ManagerBucketSelectionPanel({
  className = "ui-surface-card",
  countLabel,
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
  const columns: Array<DataTableColumn<Bucket>> = [
    {
      id: "select",
      label: "Select",
      header: <span className="sr-only">Select</span>,
      headerClassName: "w-12",
      cellClassName: "w-12",
      mobileLabel: "Select",
      render: (bucket) => (
        <input
          aria-label={`Select ${bucket.name}`}
          type="checkbox"
          checked={selectedBuckets.has(bucket.name)}
          onChange={() => onToggleBucket(bucket.name)}
          className={uiCheckboxClass}
        />
      ),
    },
    { id: "bucket", label: "Bucket", primary: true, mobileRole: "primary", render: (bucket) => bucket.name },
  ];

  return (
    <div className={className}>
      <ListToolbar
        title="Buckets"
        description={description}
        showHeading={false}
        countLabel={countLabel ?? `${buckets.length} result(s)`}
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
      <DataTableShell
        responsiveCards
        columns={columns}
        rows={buckets}
        rowKey={(bucket) => bucket.name}
        status={tableStatus}
        loadingMessage={loadingMessage}
        errorMessage={errorMessage}
        emptyMessage={emptyMessage}
        tableLayout="fixed"
      />
    </div>
  );
}
