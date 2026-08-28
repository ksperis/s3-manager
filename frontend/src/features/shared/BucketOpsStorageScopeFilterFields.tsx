/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ReactNode } from "react";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiButton from "../../components/ui/UiButton";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  advancedFilterControlClass,
  advancedFilterFieldCardClass,
  renderFilterCostIndicator,
} from "../cephAdmin/filtering/advancedFilterShared";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";
import { formatBucketNamesPreview } from "./bucketOpsPresentation";
import type { useBucketOpsStorageScopeFilters } from "./useBucketOpsStorageScopeFilters";

type StorageScopeFilters = ReturnType<typeof useBucketOpsStorageScopeFilters>;
type AdvancedFilterFieldState = ReturnType<
  typeof buildAdvancedFilterFieldState
>;

type StorageScopeFilterFieldProps = {
  allFilteredSelected: boolean;
  children: ReactNode;
  costTooltip: string;
  error: string | null;
  fieldState: AdvancedFilterFieldState;
  filterValue: string;
  filteredCount: number;
  hasFilteredSelection: boolean;
  loading: boolean;
  onDeselectFiltered: () => void;
  onFilterChange: (value: string) => void;
  onSelectFiltered: () => void;
  pluralLabel: "contexts" | "endpoints";
  selectedCount: number;
  title: "Context" | "Endpoint";
  totalCount: number;
};

function StorageScopeFilterField({
  allFilteredSelected,
  children,
  costTooltip,
  error,
  fieldState,
  filterValue,
  filteredCount,
  hasFilteredSelection,
  loading,
  onDeselectFiltered,
  onFilterChange,
  onSelectFiltered,
  pluralLabel,
  selectedCount,
  title,
  totalCount,
}: StorageScopeFilterFieldProps) {
  return (
    <div className={advancedFilterFieldCardClass("md:col-span-2")}>
      <div className="flex items-center justify-between gap-2">
        <label
          className={`ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${fieldState.labelClass}`}
        >
          <span className="inline-flex items-center gap-1">
            <span>{title}</span>
            {renderFilterCostIndicator("low", costTooltip)}
          </span>
        </label>
        <span className="ui-caption text-slate-500 dark:text-slate-400">
          {selectedCount}/{totalCount}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label={`Filter ${pluralLabel}`}
          placeholder={`Filter ${pluralLabel}`}
          className={advancedFilterControlClass(
            `min-w-0 flex-1 px-2 py-1 font-normal ${fieldState.fieldClass}`,
          )}
        />
        <UiButton
          type="button"
          onClick={onSelectFiltered}
          disabled={filteredCount === 0 || allFilteredSelected}
          variant="secondary"
          size="xs"
        >
          Select filtered
        </UiButton>
        <UiButton
          type="button"
          onClick={onDeselectFiltered}
          disabled={!hasFilteredSelection}
          variant="secondary"
          size="xs"
        >
          Deselect filtered
        </UiButton>
      </div>
      <div className="mt-2 max-h-36 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
        {loading ? (
          <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
            Loading {pluralLabel}...
          </p>
        ) : error ? (
          <p className="px-2 py-2 ui-caption text-rose-600 dark:text-rose-300">
            {error}
          </p>
        ) : filteredCount === 0 ? (
          <p className="px-2 py-2 ui-caption text-slate-500 dark:text-slate-400">
            No matching {title.toLowerCase()}.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

type BucketOpsStorageScopeFilterFieldsProps = {
  contextDraftIds: string[];
  contextFieldState: AdvancedFilterFieldState;
  controller: StorageScopeFilters;
  endpointDraftNames: string[];
  endpointFieldState: AdvancedFilterFieldState;
};

export default function BucketOpsStorageScopeFilterFields({
  contextDraftIds,
  contextFieldState,
  controller,
  endpointDraftNames,
  endpointFieldState,
}: BucketOpsStorageScopeFilterFieldsProps) {
  const {
    allFilteredStorageOpsContextsSelected,
    allFilteredStorageOpsEndpointsSelected,
    deselectFilteredStorageOpsContexts,
    deselectFilteredStorageOpsEndpoints,
    filteredStorageOpsContextItems,
    filteredStorageOpsEndpointItems,
    hasFilteredStorageOpsContextSelection,
    hasFilteredStorageOpsEndpointSelection,
    selectFilteredStorageOpsContexts,
    selectFilteredStorageOpsEndpoints,
    setStorageOpsContextFilter,
    setStorageOpsEndpointFilter,
    storageOpsContextFilter,
    storageOpsContextItems,
    storageOpsContextSelectionSet,
    storageOpsContextsError,
    storageOpsContextsLoading,
    storageOpsEndpointFilter,
    storageOpsEndpointItems,
    storageOpsEndpointSelectionSet,
    toggleAdvancedContextId,
    toggleAdvancedEndpointName,
  } = controller;

  return (
    <>
      <StorageScopeFilterField
        allFilteredSelected={allFilteredStorageOpsContextsSelected}
        costTooltip="Low cost: context filter runs on direct listing metadata."
        error={storageOpsContextsError}
        fieldState={contextFieldState}
        filterValue={storageOpsContextFilter}
        filteredCount={filteredStorageOpsContextItems.length}
        hasFilteredSelection={hasFilteredStorageOpsContextSelection}
        loading={storageOpsContextsLoading}
        onDeselectFiltered={deselectFilteredStorageOpsContexts}
        onFilterChange={setStorageOpsContextFilter}
        onSelectFiltered={selectFilteredStorageOpsContexts}
        pluralLabel="contexts"
        selectedCount={contextDraftIds.length}
        title="Context"
        totalCount={storageOpsContextItems.length}
      >
        {filteredStorageOpsContextItems.map((context) => {
              const selected = storageOpsContextSelectionSet.has(context.id);
              return (
                <label
                  key={context.id}
                  className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${
                    selected ? "bg-primary/5 dark:bg-primary-500/10" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleAdvancedContextId(context.id)}
                    className={uiCheckboxClass}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
                        {context.name}
                      </span>
                      <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {context.typeLabel}
                      </span>
                    </span>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1">
                      <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {context.endpointName ?? context.id}
                      </span>
                      <UiTagBadgeList
                        items={context.tagItems}
                        maxVisible={2}
                        variant="listing-compact"
                        layout="inline-compact"
                        className="max-w-[9rem]"
                      />
                    </div>
                  </div>
                </label>
              );
        })}
      </StorageScopeFilterField>

      <StorageScopeFilterField
        allFilteredSelected={allFilteredStorageOpsEndpointsSelected}
        costTooltip="Low cost: endpoint filter runs on direct listing metadata."
        error={storageOpsContextsError}
        fieldState={endpointFieldState}
        filterValue={storageOpsEndpointFilter}
        filteredCount={filteredStorageOpsEndpointItems.length}
        hasFilteredSelection={hasFilteredStorageOpsEndpointSelection}
        loading={storageOpsContextsLoading}
        onDeselectFiltered={deselectFilteredStorageOpsEndpoints}
        onFilterChange={setStorageOpsEndpointFilter}
        onSelectFiltered={selectFilteredStorageOpsEndpoints}
        pluralLabel="endpoints"
        selectedCount={endpointDraftNames.length}
        title="Endpoint"
        totalCount={storageOpsEndpointItems.length}
      >
        {filteredStorageOpsEndpointItems.map((endpoint) => {
              const selected = storageOpsEndpointSelectionSet.has(endpoint.name);
              return (
                <label
                  key={endpoint.name}
                  className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70 ${
                    selected ? "bg-primary/5 dark:bg-primary-500/10" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleAdvancedEndpointName(endpoint.name)}
                    className={uiCheckboxClass}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate ui-caption font-semibold text-slate-800 dark:text-slate-100">
                        {endpoint.name}
                      </span>
                      <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1 py-0 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {endpoint.contextNames.length}
                      </span>
                    </span>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1">
                      <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {formatBucketNamesPreview(endpoint.contextNames, 2)}
                      </span>
                      <UiTagBadgeList
                        items={endpoint.tagItems}
                        maxVisible={2}
                        variant="listing-compact"
                        layout="inline-compact"
                        className="max-w-[9rem]"
                      />
                    </div>
                  </div>
                </label>
              );
        })}
      </StorageScopeFilterField>
    </>
  );
}
