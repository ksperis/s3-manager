/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { Dispatch, SetStateAction } from "react";
import {
  defaultAccountAccessGrant,
  hasAccountAccessRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import type { S3AccountSummary } from "../../api/accounts";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import AdminAssociationAdvancedSettings from "./AdminAssociationAdvancedSettings";
import AccountAccessRoleSelectors, {
  AccountAccessRoleValidationMessage,
  ManagerAccountRoleSelect,
  PortalAccountRoleSelect,
} from "./AccountAccessRoleSelectors";
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

export type AccountSelection = AccountAccessGrant & {
  id: number;
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
  accountAccessChoice: Record<number, AccountAccessGrant>;
  setAccountAccessChoice: Dispatch<SetStateAction<Record<number, AccountAccessGrant>>>;
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
  const defaultAccess = defaultAccountAccessGrant(showPortalRole);
  const hasInvalidPendingSelection = accounts.selections.some(
    (accountId) =>
      !hasAccountAccessRole(accounts.accountAccessChoice[accountId] ?? defaultAccess),
  );
  const showPortalColumn = showPortalRole;

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
              <th className={adminAssociationTableHeaderClass}>Manager role</th>
              {showPortalColumn ? (
                <th className={adminAssociationTableHeaderClass}>
                  Portal role
                </th>
              ) : null}
              <th className={adminAssociationTableHeaderRightClass}>Actions</th>
            </tr>
          </thead>
          <tbody className={adminAssociationTableBodyClass}>
            {accounts.selected.length === 0 ? (
              <tr>
                <td colSpan={3 + Number(showPortalColumn)} className={adminAssociationTableEmptyCellClass}>
                  No account linked yet.
                </td>
              </tr>
            ) : (
              accounts.selected.map((entry) => {
                const label =
                  accounts.optionsById.get(Number(entry.id))?.name ??
                  `S3Account #${entry.id}`;
                const accessErrorId = `user-account-access-${entry.id}-error`;
                const invalid = !hasAccountAccessRole(entry);
                const updateAccess = (value: AccountAccessGrant) =>
                  accounts.setSelected((current) =>
                    current.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            ...value,
                          }
                        : item,
                    ),
                  );
                return (
                  <tr key={entry.id}>
                    <td className={adminAssociationTableLabelCellClass}>
                      {label}
                      <AccountAccessRoleValidationMessage
                        id={accessErrorId}
                        value={entry}
                        portalEnabled={showPortalRole}
                      />
                    </td>
                    <td className={adminAssociationTableControlCellClass}>
                      <ManagerAccountRoleSelect
                        label={label}
                        portalEnabled={showPortalRole}
                        value={entry}
                        onChange={updateAccess}
                        showLabel={false}
                        invalid={invalid}
                        describedBy={invalid ? accessErrorId : undefined}
                      />
                    </td>
                    {showPortalColumn ? (
                      <td className={adminAssociationTableControlCellClass}>
                        <PortalAccountRoleSelect
                          label={label}
                          portalEnabled={showPortalRole}
                          value={entry}
                          onChange={updateAccess}
                          showLabel={false}
                          invalid={invalid}
                          describedBy={invalid ? accessErrorId : undefined}
                        />
                      </td>
                    ) : null}
                    <td className={adminAssociationTableActionCellClass}>
                      {entry.manager_role ? (
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
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          accounts.setSelected((current) =>
                            current.filter((account) => account.id !== entry.id),
                          )
                        }
                        className={tableDeleteActionClasses}
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
          addDisabled={accounts.selections.length === 0 || hasInvalidPendingSelection}
          onCancel={() => {
            accounts.setShowPanel(false);
            accounts.setSelections([]);
            accounts.setSearch("");
          }}
          onAdd={() => {
            if (accounts.selections.length === 0) return;
            const next = accounts.selections.map((accountId) => ({
              id: accountId,
              ...(accounts.accountAccessChoice[accountId] ?? defaultAccess),
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
            const access =
              accounts.accountAccessChoice[accountId] ?? defaultAccess;
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
                  <AccountAccessRoleSelectors
                    label={option.label}
                    portalEnabled={showPortalRole}
                    value={access}
                    onChange={(value) =>
                      accounts.setAccountAccessChoice((current) => ({
                        ...current,
                        [accountId]: value,
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </AdminAssociationPickerPanel>
      ) : null}
    </div>
  );
}
