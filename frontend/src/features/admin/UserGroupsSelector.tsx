/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import type { UiGroupSummary } from "../../api/groups";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import {
  AdminAssociationLinkedTable,
  AdminAssociationPickerPanel,
  adminAssociationCheckboxClass,
  adminAssociationOptionLabelClass,
  adminAssociationOptionRowClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableLabelCellClass,
} from "./AdminAssociationPicker";

type UserGroupsSelectorProps = {
  groups: UiGroupSummary[];
  groupsLoaded: boolean;
  groupsLoading: boolean;
  maxVisibleOptions: number;
  selectedIds: number[];
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  visibleGroups: UiGroupSummary[];
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
};

export default function UserGroupsSelector({
  groups,
  groupsLoaded,
  groupsLoading,
  maxVisibleOptions,
  selectedIds,
  setSelectedIds,
  search,
  setSearch,
  visibleGroups,
  showPanel,
  setShowPanel,
  selections,
  setSelections,
}: UserGroupsSelectorProps) {
  const groupById = new Map(groups.map((group) => [group.id, group]));

  return (
    <AdminAssociationLinkedTable
      title="Linked UI groups"
      countLabel={`${selectedIds.length} linked`}
      actionLabel={showPanel ? "Close" : "Add UI groups"}
      onAction={() => setShowPanel((current) => !current)}
      headers={[{ label: "Group" }, { label: "Actions", align: "right" }]}
      hasItems={selectedIds.length > 0}
      emptyLabel="No linked groups yet."
      rows={selectedIds.map((groupId) => (
        <tr key={groupId}>
          <td className={adminAssociationTableLabelCellClass}>
            {groupById.get(groupId)?.name ?? `Group #${groupId}`}
          </td>
          <td className={adminAssociationTableActionCellClass}>
            <button
              type="button"
              className={tableDeleteActionClasses}
              onClick={() =>
                setSelectedIds((current) => current.filter((id) => id !== groupId))
              }
            >
              Remove
            </button>
          </td>
        </tr>
      ))}
      picker={
        showPanel ? (
          <AdminAssociationPickerPanel
            title="Add UI groups"
            hint="(search by name)"
            search={search}
            onSearchChange={setSearch}
            searchAriaLabel="Search UI groups"
            loading={groupsLoading}
            availableCount={visibleGroups.length}
            maxVisibleOptions={maxVisibleOptions}
            selectedCount={selections.length}
            loadingLabel="Loading groups..."
            emptyLabel={groupsLoaded ? "No UI groups available." : "No results."}
            addDisabled={selections.length === 0}
            onCancel={() => {
              setShowPanel(false);
              setSelections([]);
              setSearch("");
            }}
            onAdd={() => {
              setSelectedIds((current) =>
                [...new Set([...current, ...selections])].sort((left, right) => left - right),
              );
              setShowPanel(false);
              setSelections([]);
              setSearch("");
            }}
          >
            {visibleGroups.slice(0, maxVisibleOptions).map((group) => {
              const checked = selections.includes(group.id);
              return (
                <label key={group.id} className={adminAssociationOptionRowClass(checked)}>
                  <span className={adminAssociationOptionLabelClass}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelections((current) =>
                          current.includes(group.id)
                            ? current.filter((id) => id !== group.id)
                            : [...current, group.id],
                        )
                      }
                      className={adminAssociationCheckboxClass}
                    />
                    <span>{group.name}</span>
                  </span>
                  {group.description ? (
                    <span className="max-w-md truncate ui-caption text-slate-500 dark:text-slate-400">
                      {group.description}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </AdminAssociationPickerPanel>
        ) : undefined
      }
    />
  );
}
