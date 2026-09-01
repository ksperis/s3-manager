/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import {
  ACCOUNT_ACCESS_ROLE_OPTIONS,
  normalizeAccountAccessRole,
  type AccountAccessRole,
} from "../../api/accountRoles";
import type { S3AccountSummary } from "../../api/accounts";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiSelect from "../../components/ui/UiSelect";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import {
  AdminAssociationPickerPanel,
  AdminAssociationSectionHeader,
  adminAssociationAccountOptionRowClass,
  adminAssociationCheckboxClass,
  adminAssociationOptionLabelClass,
  adminAssociationTableActionCellClass,
  adminAssociationTableBodyClass,
  adminAssociationTableContainerClass,
  adminAssociationTableControlCellClass,
  adminAssociationTableEmptyCellClass,
  adminAssociationTableHeaderClass,
  adminAssociationTableHeadClass,
  adminAssociationTableHeaderRightClass,
  adminAssociationTableLabelCellClass,
  adminAssociationTableClass,
} from "./AdminAssociationPicker";

export type AccountSelection = {
  id: number;
  role: AccountAccessRole;
  allow_manager_browser_data_access?: boolean;
  is_root?: boolean;
};

type AccountOption = {
  id: number;
  label: string;
};

export type UserAccountAssociationsState = {
  selected: AccountSelection[];
  setSelected: Dispatch<SetStateAction<AccountSelection[]>>;
  optionsById: Map<number, S3AccountSummary>;
  available: AccountOption[];
  visible: AccountOption[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  loading: boolean;
  showPanel: boolean;
  setShowPanel: Dispatch<SetStateAction<boolean>>;
  selections: number[];
  setSelections: Dispatch<SetStateAction<number[]>>;
  portalRoleChoice: Record<number, AccountAccessRole>;
  setPortalRoleChoice: Dispatch<SetStateAction<Record<number, AccountAccessRole>>>;
  toggleSelection: (id: number) => void;
};

type UserAccountAssociationsPanelProps = {
  accounts: UserAccountAssociationsState;
  maxVisibleOptions: number;
  showPortalRole: boolean;
};

export default function UserAccountAssociationsPanel({
  accounts,
  maxVisibleOptions,
  showPortalRole,
}: UserAccountAssociationsPanelProps) {
  return (
    <div className="space-y-3">
      <AdminAssociationSectionHeader
        title="Linked accounts"
        countLabel={`${accounts.selected.length} linked`}
        actionLabel={accounts.showPanel ? "Close" : "Add accounts"}
        onAction={() => accounts.setShowPanel((current) => !current)}
      />
      <div className={adminAssociationTableContainerClass}>
        <table className={adminAssociationTableClass}>
          <thead className={adminAssociationTableHeadClass}>
            <tr>
              <th className={adminAssociationTableHeaderClass}>Account</th>
              <th className={adminAssociationTableHeaderClass}>Access role</th>
              <th className={adminAssociationTableHeaderRightClass}>Actions</th>
            </tr>
          </thead>
          <tbody className={adminAssociationTableBodyClass}>
            {accounts.selected.length === 0 ? (
              <tr>
                <td colSpan={3} className={adminAssociationTableEmptyCellClass}>
                  No account linked yet.
                </td>
              </tr>
            ) : (
              accounts.selected.map((entry) => {
                const label =
                  accounts.optionsById.get(Number(entry.id))?.name ??
                  `S3Account #${entry.id}`;
                return (
                  <tr key={entry.id}>
                    <td className={adminAssociationTableLabelCellClass}>{label}</td>
                    <td className={adminAssociationTableControlCellClass}>
                      <UiSelect
                        aria-label={`Access role for ${label}`}
                        size="compact"
                        fieldClassName="w-52"
                        value={normalizeAccountAccessRole(entry.role)}
                        disabled={Boolean(entry.is_root)}
                        onChange={(event) =>
                          accounts.setSelected((current) =>
                            current.map((item) =>
                              item.id === entry.id
                                ? {
                                    ...item,
                                    role: normalizeAccountAccessRole(event.target.value),
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {ACCOUNT_ACCESS_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </UiSelect>
                    </td>
                    <td className={adminAssociationTableActionCellClass}>
                      <AdminAssociationAdvancedSettings
                        targetLabel={label}
                        associationKind="account"
                        allowManagerBrowserDataAccess={Boolean(
                          entry.allow_manager_browser_data_access,
                        )}
                        onApply={(allowed) =>
                          accounts.setSelected((current) =>
                            current.map((item) =>
                              item.id === entry.id
                                ? {
                                    ...item,
                                    allow_manager_browser_data_access: allowed,
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          accounts.setSelected((current) =>
                            current.filter((account) => account.id !== entry.id),
                          )
                        }
                        className={tableDeleteActionClasses}
                        disabled={Boolean(entry.is_root)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {accounts.showPanel ? (
        <AdminAssociationPickerPanel
          title="Add accounts"
          hint="(search by name)"
          search={accounts.search}
          onSearchChange={accounts.setSearch}
          loading={accounts.loading}
          availableCount={accounts.available.length}
          maxVisibleOptions={maxVisibleOptions}
          selectedCount={accounts.selections.length}
          loadingLabel="Loading accounts..."
          addDisabled={accounts.selections.length === 0}
          onCancel={() => {
            accounts.setShowPanel(false);
            accounts.setSelections([]);
            accounts.setSearch("");
          }}
          onAdd={() => {
            if (accounts.selections.length === 0) return;
            const next = accounts.selections.map((accountId) => ({
              id: accountId,
              role:
                accounts.portalRoleChoice[accountId] ??
                (showPortalRole ? "portal_user" : "account_administrator"),
              allow_manager_browser_data_access: false,
            }));
            accounts.setSelected((current) => [...current, ...next]);
            accounts.setSelections([]);
            accounts.setSearch("");
            accounts.setShowPanel(false);
          }}
        >
          {accounts.visible.map((option) => {
            const accountId = Number(option.id);
            const isSelected = accounts.selections.includes(accountId);
            const role =
              accounts.portalRoleChoice[accountId] ??
              (showPortalRole ? "portal_user" : "account_administrator");
            return (
              <div
                key={option.id}
                className={adminAssociationAccountOptionRowClass(isSelected)}
              >
                <label className={adminAssociationOptionLabelClass}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => accounts.toggleSelection(accountId)}
                    className={adminAssociationCheckboxClass}
                  />
                  <span>{option.label}</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <UiSelect
                    aria-label={`Access role for ${option.label}`}
                    size="compact"
                    fieldClassName="w-52"
                    value={role}
                    onChange={(event) =>
                      accounts.setPortalRoleChoice((current) => ({
                        ...current,
                        [accountId]: normalizeAccountAccessRole(event.target.value),
                      }))
                    }
                  >
                    {ACCOUNT_ACCESS_ROLE_OPTIONS.map((roleOption) => (
                      <option key={roleOption.value} value={roleOption.value}>
                        {roleOption.label}
                      </option>
                    ))}
                  </UiSelect>
                </div>
              </div>
            );
          })}
        </AdminAssociationPickerPanel>
      ) : null}
    </div>
  );
}
