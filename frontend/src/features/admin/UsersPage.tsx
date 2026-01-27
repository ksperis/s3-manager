/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CreateUserPayload,
  UpdateUserPayload,
  User,
  assignUserToS3Account,
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "../../api/users";
import { S3AccountSummary, listMinimalS3Accounts, updateS3Account } from "../../api/accounts";
import { S3UserSummary, listMinimalS3Users } from "../../api/s3Users";
import { S3ConnectionSummary, listMinimalS3Connections } from "../../api/s3ConnectionsAdmin";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import PaginationControls from "../../components/PaginationControls";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";

type AssociationTab = "accounts" | "s3_users" | "connections";

type AccountSelection = {
  id: number;
  role: string;
  account_admin?: boolean;
};

type Option = {
  id: number;
  label: string;
};

type AssociationsTabsProps = {
  activeTab: AssociationTab;
  onTabChange: (tab: AssociationTab) => void;
  portalEnabled: boolean;
  maxVisibleOptions: number;
  accounts: {
    selected: AccountSelection[];
    setSelected: Dispatch<SetStateAction<AccountSelection[]>>;
    optionsById: Map<number, S3AccountSummary>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    roleChoice: Record<number, string>;
    setRoleChoice: Dispatch<SetStateAction<Record<number, string>>>;
    adminChoice: Record<number, boolean>;
    setAdminChoice: Dispatch<SetStateAction<Record<number, boolean>>>;
    toggleSelection: (id: number) => void;
  };
  s3Users: {
    selected: number[];
    setSelected: Dispatch<SetStateAction<number[]>>;
    labelById: Map<number, string>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    toggleSelection: (id: number) => void;
  };
  connections: {
    selected: number[];
    setSelected: Dispatch<SetStateAction<number[]>>;
    labelById: Map<number, string>;
    available: Option[];
    visible: Option[];
    search: string;
    setSearch: Dispatch<SetStateAction<string>>;
    loading: boolean;
    showPanel: boolean;
    setShowPanel: Dispatch<SetStateAction<boolean>>;
    selections: number[];
    setSelections: Dispatch<SetStateAction<number[]>>;
    toggleSelection: (id: number) => void;
  };
};

const AssociationsTabs = ({
  activeTab,
  onTabChange,
  portalEnabled,
  maxVisibleOptions,
  accounts,
  s3Users,
  connections,
}: AssociationsTabsProps) => {
  const totalSelected =
    accounts.selected.length + s3Users.selected.length + connections.selected.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="ui-body font-medium text-slate-700">Associations</label>
          <span className="ui-caption text-slate-500">{totalSelected} total</span>
        </div>
      </div>
      <PageTabs
        tabs={[
          {
            id: "accounts",
            label: `Accounts (${accounts.selected.length})`,
            content: (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="ui-body font-medium text-slate-700">Linked accounts</span>
                    <span className="ui-caption text-slate-500">{accounts.selected.length} linked</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => accounts.setShowPanel((prev) => !prev)}
                    className={tableActionButtonClasses}
                  >
                    {accounts.showPanel ? "Close" : "Add accounts"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Account
                        </th>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {portalEnabled ? "Portal role" : "Portal access"}
                        </th>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Admin
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {accounts.selected.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No account linked yet.
                          </td>
                        </tr>
                      ) : (
                        accounts.selected.map((entry) => {
                          const label =
                            accounts.optionsById.get(Number(entry.id))?.name ?? `S3Account #${entry.id}`;
                          return (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">{label}</td>
                              <td className="px-3 py-2">
                                {portalEnabled ? (
                                  <select
                                    className="w-full rounded-md border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                    value={entry.role}
                                    onChange={(e) =>
                                      accounts.setSelected((prev) =>
                                        prev.map((item) =>
                                          item.id === entry.id ? { ...item, role: e.target.value } : item
                                        )
                                      )
                                    }
                                  >
                                    <option value="portal_user">Portal user</option>
                                    <option value="portal_manager">Portal manager</option>
                                    <option value="portal_none">Portal none</option>
                                  </select>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                {portalEnabled ? (
                                  <label className="flex items-center gap-2 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(entry.account_admin)}
                                      onChange={(e) =>
                                        accounts.setSelected((prev) =>
                                          prev.map((item) =>
                                            item.id === entry.id ? { ...item, account_admin: e.target.checked } : item
                                          )
                                        )
                                      }
                                      className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                    />
                                    Admin
                                  </label>
                                ) : (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                    Admin
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    accounts.setSelected((prev) => prev.filter((acc) => acc.id !== entry.id))
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
                {accounts.showPanel && (
                  <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="ui-body font-medium text-slate-700">Add accounts</span>
                        <span className="ui-caption text-slate-500 dark:text-slate-400">(search by name)</span>
                      </div>
                      <input
                        type="text"
                        value={accounts.search}
                        onChange={(e) => accounts.setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {accounts.loading ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">Loading accounts...</p>
                      ) : accounts.available.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                      ) : null}
                      {accounts.visible.map((opt) => {
                        const accountId = Number(opt.id);
                        const isSelected = accounts.selections.includes(accountId);
                        const role = accounts.roleChoice[accountId] ?? "portal_none";
                        const adminChecked = portalEnabled
                          ? accounts.adminChoice[accountId] ?? role === "portal_manager"
                          : true;
                        return (
                          <div
                            key={opt.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${
                              isSelected
                                ? "bg-slate-50 dark:bg-slate-800/60"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => accounts.toggleSelection(accountId)}
                                className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <span>{opt.label}</span>
                            </label>
                            <div className="flex items-center gap-2">
                              {portalEnabled ? (
                                <select
                                  className="rounded-full border border-slate-200 px-2 py-1 ui-caption font-semibold uppercase tracking-wide text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                  value={role}
                                  onChange={(e) =>
                                    accounts.setRoleChoice((prev) => ({
                                      ...prev,
                                      [accountId]: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="portal_user">Portal user</option>
                                  <option value="portal_manager">Portal manager</option>
                                  <option value="portal_none">Portal none</option>
                                </select>
                              ) : null}
                              {portalEnabled ? (
                                <label className="flex items-center gap-1 ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(adminChecked)}
                                    onChange={(e) =>
                                      accounts.setAdminChoice((prev) => ({
                                        ...prev,
                                        [accountId]: e.target.checked,
                                      }))
                                    }
                                    className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                                  />
                                  Admin
                                </label>
                              ) : (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                                  Admin
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {accounts.available.length > maxVisibleOptions && (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        {accounts.selections.length} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            accounts.setShowPanel(false);
                            accounts.setSelections([]);
                            accounts.setSearch("");
                          }}
                          className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={accounts.selections.length === 0}
                          onClick={() => {
                            if (accounts.selections.length === 0) return;
                            const next = accounts.selections.map((accountId) => {
                              const role = accounts.roleChoice[accountId] ?? "portal_none";
                              const account_admin = portalEnabled
                                ? accounts.adminChoice[accountId] ?? role === "portal_manager"
                                : true;
                              return { id: accountId, role, account_admin };
                            });
                            accounts.setSelected((prev) => [...prev, ...next]);
                            accounts.setSelections([]);
                            accounts.setSearch("");
                            accounts.setShowPanel(false);
                          }}
                          className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                        >
                          Add selected
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "s3_users",
            label: `S3 Users (${s3Users.selected.length})`,
            content: (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="ui-body font-medium text-slate-700">Linked users</span>
                    <span className="ui-caption text-slate-500">{s3Users.selected.length} linked</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => s3Users.setShowPanel((prev) => !prev)}
                    className={tableActionButtonClasses}
                  >
                    {s3Users.showPanel ? "Close" : "Add users"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          User
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {s3Users.selected.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No user linked yet.
                          </td>
                        </tr>
                      ) : (
                        s3Users.selected.map((id) => (
                          <tr key={id}>
                            <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                              {s3Users.labelById.get(id) ?? `User #${id}`}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => s3Users.setSelected((prev) => prev.filter((s3Id) => s3Id !== id))}
                                className={tableDeleteActionClasses}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {s3Users.showPanel && (
                  <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="ui-body font-medium text-slate-700">Add users</span>
                        <span className="ui-caption text-slate-500 dark:text-slate-400">(search by name)</span>
                      </div>
                      <input
                        type="text"
                        value={s3Users.search}
                        onChange={(e) => s3Users.setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {s3Users.loading ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">Loading users...</p>
                      ) : s3Users.available.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                      ) : null}
                      {s3Users.visible.map((opt) => {
                        const isSelected = s3Users.selections.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={`flex items-center justify-between rounded-md px-2 py-1 ${
                              isSelected
                                ? "bg-slate-50 dark:bg-slate-800/60"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => s3Users.toggleSelection(opt.id)}
                                className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <span>{opt.label}</span>
                            </label>
                          </div>
                        );
                      })}
                      {s3Users.available.length > maxVisibleOptions && (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        {s3Users.selections.length} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            s3Users.setShowPanel(false);
                            s3Users.setSelections([]);
                            s3Users.setSearch("");
                          }}
                          className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={s3Users.selections.length === 0}
                          onClick={() => {
                            if (s3Users.selections.length === 0) return;
                            s3Users.setSelected((prev) => [...prev, ...s3Users.selections]);
                            s3Users.setSelections([]);
                            s3Users.setSearch("");
                            s3Users.setShowPanel(false);
                          }}
                          className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                        >
                          Add selected
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "connections",
            label: `Connections (${connections.selected.length})`,
            content: (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="ui-body font-medium text-slate-700">Linked connections</span>
                    <span className="ui-caption text-slate-500">{connections.selected.length} linked</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => connections.setShowPanel((prev) => !prev)}
                    className={tableActionButtonClasses}
                  >
                    {connections.showPanel ? "Close" : "Add connections"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Connection
                        </th>
                        <th className="px-3 py-2 text-right ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {connections.selected.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-3 py-3 ui-body text-slate-500 dark:text-slate-400">
                            No connection linked yet.
                          </td>
                        </tr>
                      ) : (
                        connections.selected.map((id) => (
                          <tr key={id}>
                            <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                              {connections.labelById.get(id) ?? `Connection #${id}`}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  connections.setSelected((prev) => prev.filter((connId) => connId !== id))
                                }
                                className={tableDeleteActionClasses}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {connections.showPanel && (
                  <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="ui-body font-medium text-slate-700">Add connections</span>
                        <span className="ui-caption text-slate-500 dark:text-slate-400">(search by name)</span>
                      </div>
                      <input
                        type="text"
                        value={connections.search}
                        onChange={(e) => connections.setSearch(e.target.value)}
                        placeholder="Search..."
                        className="w-44 rounded-md border border-slate-200 px-2 py-1 ui-caption focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {connections.loading ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">Loading connections...</p>
                      ) : connections.available.length === 0 ? (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">No results.</p>
                      ) : null}
                      {connections.visible.map((opt) => {
                        const isSelected = connections.selections.includes(opt.id);
                        return (
                          <div
                            key={opt.id}
                            className={`flex items-center justify-between rounded-md px-2 py-1 ${
                              isSelected
                                ? "bg-slate-50 dark:bg-slate-800/60"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                            }`}
                          >
                            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => connections.toggleSelection(opt.id)}
                                className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <span>{opt.label}</span>
                            </label>
                          </div>
                        );
                      })}
                      {connections.available.length > maxVisibleOptions && (
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Showing first {maxVisibleOptions} matches. Use the search box to narrow down the list.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        {connections.selections.length} selected
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            connections.setShowPanel(false);
                            connections.setSelections([]);
                            connections.setSearch("");
                          }}
                          className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={connections.selections.length === 0}
                          onClick={() => {
                            if (connections.selections.length === 0) return;
                            connections.setSelected((prev) => [...prev, ...connections.selections]);
                            connections.setSelections([]);
                            connections.setSearch("");
                            connections.setShowPanel(false);
                          }}
                          className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                        >
                          Add selected
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ),
          },
        ]}
        activeTab={activeTab}
        onChange={(id) => {
          const nextTab = id === "s3_users" ? "s3_users" : id === "connections" ? "connections" : "accounts";
          onTabChange(nextTab);
        }}
      />
    </div>
  );
};

export default function UsersPage() {
  type SortField = "email" | "role" | "accounts" | "last_login_at";

  const MAX_VISIBLE_OPTIONS = 10;
  const { generalSettings } = useGeneralSettings();
  const portalEnabled = generalSettings.portal_enabled;
  const [users, setUsers] = useState<User[]>([]);
  const [accounts, setS3Accounts] = useState<S3AccountSummary[]>([]);
  const [s3AccountsLoaded, setS3AccountsLoaded] = useState(false);
  const [s3AccountsLoading, setS3AccountsLoading] = useState(false);
  const [s3Users, setS3Users] = useState<S3UserSummary[]>([]);
  const [s3UsersLoaded, setS3UsersLoaded] = useState(false);
  const [s3UsersLoading, setS3UsersLoading] = useState(false);
  const [s3Connections, setS3Connections] = useState<S3ConnectionSummary[]>([]);
  const [s3ConnectionsLoaded, setS3ConnectionsLoaded] = useState(false);
  const [s3ConnectionsLoading, setS3ConnectionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const createFormTemplate = (): CreateUserPayload => ({
    email: "",
    password: "",
    role: "ui_user",
  });
  const [form, setForm] = useState<CreateUserPayload>(() => createFormTemplate());
  const [createSelectedS3Accounts, setCreateSelectedS3Accounts] = useState<{ id: number; role: string; account_admin?: boolean }[]>([]);
  const [createSelectedS3Users, setCreateSelectedS3Users] = useState<number[]>([]);
  const [createSelectedS3Connections, setCreateSelectedS3Connections] = useState<number[]>([]);
  const [createAccountRoleChoice, setCreateAccountRoleChoice] = useState<Record<number, string>>({});
  const [createAccountAdminChoice, setCreateAccountAdminChoice] = useState<Record<number, boolean>>({});
  const [createS3AccountSearch, setCreateS3AccountSearch] = useState("");
  const [createS3Search, setCreateS3Search] = useState("");
  const [createConnectionSearch, setCreateConnectionSearch] = useState("");
  const [createAssociationsTab, setCreateAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showCreateAccountPanel, setShowCreateAccountPanel] = useState(false);
  const [createAccountSelections, setCreateAccountSelections] = useState<number[]>([]);
  const [showCreateS3UserPanel, setShowCreateS3UserPanel] = useState(false);
  const [createS3UserSelections, setCreateS3UserSelections] = useState<number[]>([]);
  const [showCreateConnectionPanel, setShowCreateConnectionPanel] = useState(false);
  const [createConnectionSelections, setCreateConnectionSelections] = useState<number[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<UpdateUserPayload>({});
  const [editSelectedS3Accounts, setEditSelectedS3Accounts] = useState<{ id: number; role: string; account_admin?: boolean }[]>([]);
  const [editSelectedS3Users, setEditSelectedS3Users] = useState<number[]>([]);
  const [editSelectedS3Connections, setEditSelectedS3Connections] = useState<number[]>([]);
  const [editAccountRoleChoice, setEditAccountRoleChoice] = useState<Record<number, string>>({});
  const [editAccountAdminChoice, setEditAccountAdminChoice] = useState<Record<number, boolean>>({});
  const [editS3AccountSearch, setEditS3AccountSearch] = useState("");
  const [editS3Search, setEditS3Search] = useState("");
  const [editConnectionSearch, setEditConnectionSearch] = useState("");
  const [editAssociationsTab, setEditAssociationsTab] = useState<"accounts" | "s3_users" | "connections">("accounts");
  const [showEditAccountPanel, setShowEditAccountPanel] = useState(false);
  const [editAccountSelections, setEditAccountSelections] = useState<number[]>([]);
  const [showEditS3UserPanel, setShowEditS3UserPanel] = useState(false);
  const [editS3UserSelections, setEditS3UserSelections] = useState<number[]>([]);
  const [showEditConnectionPanel, setShowEditConnectionPanel] = useState(false);
  const [editConnectionSelections, setEditConnectionSelections] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "email",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalUsers, setTotalUsers] = useState(0);
  const accountDbId = (account: S3AccountSummary) => account.db_id ?? Number(account.id);
  const accountOptions = useMemo(
    () =>
      accounts
        .map((a) => ({ id: accountDbId(a), label: a.name }))
        .filter((a) => !Number.isNaN(Number(a.id))),
    [accounts]
  );
  const accountOptionsById = useMemo(() => {
    const map = new Map<number, S3AccountSummary>();
    accounts.forEach((a) => {
      const idNum = Number(a.db_id ?? a.id);
      if (!Number.isNaN(idNum)) {
        map.set(idNum, a);
      }
    });
    return map;
  }, [accounts]);
  const s3UserOptions = useMemo(() => s3Users.map((u) => ({ id: u.id, label: u.name })), [s3Users]);
  const s3UserLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Users.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [s3Users]);
  const s3ConnectionOptions = useMemo(
    () =>
      s3Connections.map((conn) => ({
        id: conn.id,
        label: conn.name,
        owner_user_id: conn.owner_user_id ?? null,
      })),
    [s3Connections]
  );
  const s3ConnectionLabelById = useMemo(() => {
    const map = new Map<number, string>();
    s3Connections.forEach((conn) => map.set(conn.id, conn.name));
    return map;
  }, [s3Connections]);
  const availableCreateS3Accounts = useMemo(() => {
    const query = createS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(createSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, createS3AccountSearch, createSelectedS3Accounts]);
  const availableEditS3Accounts = useMemo(() => {
    const query = editS3AccountSearch.trim().toLowerCase();
    const selectedIds = new Set(editSelectedS3Accounts.map((a) => Number(a.id)));
    return accountOptions.filter(
      (a) => !selectedIds.has(Number(a.id)) && (!query || a.label.toLowerCase().includes(query))
    );
  }, [accountOptions, editS3AccountSearch, editSelectedS3Accounts]);
  const availableCreateS3Users = useMemo(() => {
    const query = createS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !createSelectedS3Users.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, createSelectedS3Users, createS3Search]);
  const availableCreateS3Connections = useMemo(() => {
    const query = createConnectionSearch.trim().toLowerCase();
    return s3ConnectionOptions.filter(
      (opt) =>
        !createSelectedS3Connections.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3ConnectionOptions, createSelectedS3Connections, createConnectionSearch]);
  const availableEditS3Users = useMemo(() => {
    const query = editS3Search.trim().toLowerCase();
    return s3UserOptions.filter(
      (opt) => !editSelectedS3Users.includes(opt.id) && (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3UserOptions, editSelectedS3Users, editS3Search]);
  const availableEditS3Connections = useMemo(() => {
    const query = editConnectionSearch.trim().toLowerCase();
    return s3ConnectionOptions.filter(
      (opt) =>
        !editSelectedS3Connections.includes(opt.id) &&
        (!editingUser || opt.owner_user_id !== editingUser.id) &&
        (!query || opt.label.toLowerCase().includes(query))
    );
  }, [s3ConnectionOptions, editSelectedS3Connections, editConnectionSearch, editingUser]);
  const limitedOptions = <T,>(options: T[]) => options.slice(0, MAX_VISIBLE_OPTIONS);
  const visibleCreateS3Accounts = limitedOptions(availableCreateS3Accounts);
  const visibleEditS3Accounts = limitedOptions(availableEditS3Accounts);
  const visibleCreateS3Users = limitedOptions(availableCreateS3Users);
  const visibleCreateS3Connections = limitedOptions(availableCreateS3Connections);
  const visibleEditS3Users = limitedOptions(availableEditS3Users);
  const visibleEditS3Connections = limitedOptions(availableEditS3Connections);
  const normalizeUiRoleValue = (role?: string | null): string => {
    const value = (role || "").toLowerCase();
    if (value === "ui_admin" || value === "super_admin" || value === "account_admin") return "ui_admin";
    if (value === "ui_none" || value === "none") return "ui_none";
    return "ui_user";
  };
  const displayUiRole = (role?: string | null) => {
    const value = (role || "").toLowerCase();
    if (value === "ui_admin" || value === "super_admin" || value === "account_admin") return "Admin";
    if (value === "ui_user" || value === "account_user") return "User";
    if (value === "ui_none" || value === "none") return "No access";
    return role || "-";
  };
  const renderS3UserChips = useCallback(
    (user: User) => {
      const labels =
        user.s3_user_details && user.s3_user_details.length > 0
          ? user.s3_user_details.map((entry) => entry.name || `User #${entry.id}`)
          : (user.s3_users ?? []).map((id) => s3UserLabelById.get(Number(id)) ?? `User #${id}`);
      if (labels.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-2">
          {labels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              {label}
            </span>
          ))}
        </div>
      );
    },
    [s3UserLabelById]
  );
  const renderS3ConnectionChips = useCallback(
    (user: User) => {
      const linkedIds = (user.s3_connections ?? []).map((id) => Number(id));
      const linkedLabels =
        user.s3_connection_details && user.s3_connection_details.length > 0
          ? user.s3_connection_details.map((entry) => ({
              id: entry.id,
              label: entry.name || `Connection #${entry.id}`,
            }))
          : linkedIds.map((id) => ({
              id,
              label: s3ConnectionLabelById.get(Number(id)) ?? `Connection #${id}`,
            }));
      const linkedIdSet = new Set(linkedIds);
      const ownedConnections = s3Connections.filter((conn) => conn.owner_user_id === user.id);
      const ownedLabels = ownedConnections
        .filter((conn) => !linkedIdSet.has(conn.id))
        .map((conn) => ({ id: conn.id, label: conn.name || `Connection #${conn.id}` }));
      if (linkedLabels.length === 0 && ownedLabels.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-2">
          {ownedLabels.map((entry) => (
            <span
              key={`owned-${entry.id}`}
              className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-2 py-0.5 ui-caption font-semibold text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
              title="Owner"
            >
              {entry.label}
            </span>
          ))}
          {linkedLabels.map((entry) => (
            <span
              key={`linked-${entry.id}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              {entry.label}
            </span>
          ))}
        </div>
      );
    },
    [s3ConnectionLabelById, s3Connections]
  );
  const editRoleValue = editForm.role ?? editingUser?.role ?? "ui_user";

  const formatLastLogin = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  };

  const renderAccountChips = (user: User) => {
    if (!user.accounts || user.accounts.length === 0) return null;
    const roleByAccountId = new Map<number, string | null>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
    );
    const adminByAccountId = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    return (
      <div className="flex flex-wrap gap-2">
        {user.accounts.map((id) => {
          const label = accountOptionsById.get(Number(id))?.name ?? `Account #${id}`;
          const role = roleByAccountId.get(Number(id)) ?? "portal_none";
          const isAccountAdmin = adminByAccountId.get(Number(id)) === true;
          const showPortalBadge = portalEnabled && role !== "portal_none";
          const tone =
            role === "portal_manager"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100"
              : role === "portal_user"
              ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100"
              : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
          const displayRole = role === "portal_manager" ? "Portal manager" : role === "portal_user" ? "Portal user" : role;
          return (
            <span
              key={`${id}-${role}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
            >
              <span>{label}</span>
              {showPortalBadge && (
                <span className={`rounded-full px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide ${tone}`}>
                  {displayRole}
                </span>
              )}
              {isAccountAdmin && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 ui-badge font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                  Admin
                </span>
              )}
            </span>
          );
        })}
      </div>
    );
  };

  const renderAssociationSummary = (user: User) => {
    const hasAccounts = Boolean(user.accounts && user.accounts.length > 0);
    const hasS3Users = Boolean(user.s3_users && user.s3_users.length > 0);
    const hasOwnedConnections = s3Connections.some((conn) => conn.owner_user_id === user.id);
    const hasConnections = Boolean(user.s3_connections && user.s3_connections.length > 0) || hasOwnedConnections;
    if (!hasAccounts && !hasS3Users && !hasConnections) {
      return <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>;
    }
    const accountChips = hasAccounts ? renderAccountChips(user) : null;
    const s3UserChips = hasS3Users ? renderS3UserChips(user) : null;
    const connectionChips = hasConnections ? renderS3ConnectionChips(user) : null;
    const sections = [
      { label: "Accounts", value: accountChips ?? "-" },
      { label: "Users", value: s3UserChips ?? "-" },
      { label: "Connections", value: connectionChips ?? "-" },
    ].filter((section) => {
      if (section.label === "Accounts") return hasAccounts;
      if (section.label === "Users") return hasS3Users;
      return hasConnections;
    });
    if (sections.length > 1) {
      return (
        <div className="space-y-1">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {section.label}
              </div>
              <div className="ui-caption text-slate-600 dark:text-slate-300">{section.value}</div>
            </div>
          ))}
        </div>
      );
    }
    const single = sections[0];
    return (
      <div>
        <div className="ui-badge font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {single.label}
        </div>
        <div className="ui-caption text-slate-600 dark:text-slate-300">{single.value}</div>
      </div>
    );
  };

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
    setPage(1);
  };

  const handleFilterChange = (value: string) => {
    setFilter(value);
    setPage(1);
  };

  const handlePageChange = (nextPage: number) => {
    if (nextPage === page) return;
    setPage(Math.max(1, nextPage));
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const extractError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      return (
        (err.response?.data as { detail?: string })?.detail ||
        err.message ||
        "Unexpected error"
      );
    }
    return err instanceof Error ? err.message : "Unexpected error";
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const searchValue = filter.trim();
      const response = await listUsers({
        page,
        page_size: pageSize,
        search: searchValue || undefined,
        sort_by: sort.field,
        sort_dir: sort.direction,
      });
      const totalPages = Math.max(1, Math.ceil((response.total || 0) / pageSize));
      if (response.total > 0 && page > totalPages) {
        setPage(totalPages);
        return;
      }
      setUsers(response.items);
      setTotalUsers(response.total);
    } catch (err) {
      setError("Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize, sort.direction, sort.field]);

  const fetchS3Accounts = useCallback(async () => {
    setS3AccountsLoading(true);
    try {
      const data = await listMinimalS3Accounts();
      setS3Accounts(data);
      setS3AccountsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setS3AccountsLoading(false);
    }
  }, []);

  const fetchS3Users = useCallback(async () => {
    setS3UsersLoading(true);
    try {
      const data = await listMinimalS3Users();
      setS3Users(data);
      setS3UsersLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setS3UsersLoading(false);
    }
  }, []);

  const fetchS3Connections = useCallback(async () => {
    setS3ConnectionsLoading(true);
    try {
      const data = await listMinimalS3Connections();
      setS3Connections(data);
      setS3ConnectionsLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setS3ConnectionsLoading(false);
    }
  }, []);

  const ensureS3Accounts = useCallback(async () => {
    if (s3AccountsLoaded || s3AccountsLoading) return;
    await fetchS3Accounts();
  }, [s3AccountsLoaded, s3AccountsLoading, fetchS3Accounts]);

  const ensureS3Users = useCallback(async () => {
    if (s3UsersLoaded || s3UsersLoading) return;
    await fetchS3Users();
  }, [s3UsersLoaded, s3UsersLoading, fetchS3Users]);

  const ensureS3Connections = useCallback(async () => {
    if (s3ConnectionsLoaded || s3ConnectionsLoading) return;
    await fetchS3Connections();
  }, [s3ConnectionsLoaded, s3ConnectionsLoading, fetchS3Connections]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (showCreateModal) {
      if (createAssociationsTab === "accounts") {
        ensureS3Accounts();
      } else if (createAssociationsTab === "s3_users") {
        ensureS3Users();
      } else {
        ensureS3Connections();
      }
      return;
    }
    if (showEditModal) {
      if (editAssociationsTab === "accounts") {
        ensureS3Accounts();
      } else if (editAssociationsTab === "s3_users") {
        ensureS3Users();
      } else {
        ensureS3Connections();
      }
    }
  }, [
    showCreateModal,
    showEditModal,
    createAssociationsTab,
    editAssociationsTab,
    ensureS3Accounts,
    ensureS3Users,
    ensureS3Connections,
  ]);

  const toggleCreateAccountSelection = (accountId: number) => {
    setCreateAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleCreateS3UserSelection = (userId: number) => {
    setCreateS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleCreateConnectionSelection = (connectionId: number) => {
    setCreateConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };

  const toggleEditAccountSelection = (accountId: number) => {
    setEditAccountSelections((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  };

  const toggleEditS3UserSelection = (userId: number) => {
    setEditS3UserSelections((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleEditConnectionSelection = (connectionId: number) => {
    setEditConnectionSelections((prev) =>
      prev.includes(connectionId) ? prev.filter((id) => id !== connectionId) : [...prev, connectionId]
    );
  };


  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionMessage(null);
    if (!form.email || !form.password) {
      setActionError("Email and password are required.");
      return;
    }
    const payload: CreateUserPayload = {
      email: form.email,
      password: form.password,
      role: form.role,
    };
    try {
      const created = await createUser(payload);
      if (created?.id && createSelectedS3Accounts.length > 0) {
        await Promise.all(
          createSelectedS3Accounts.map((entry) =>
            assignUserToS3Account(
              created.id,
              Number(entry.id),
              portalEnabled ? (entry.role as string | undefined) : undefined,
              portalEnabled ? entry.account_admin ?? entry.role === "portal_manager" : true
            )
          )
        );
      }
      if (created?.id) {
        const associationsPayload: UpdateUserPayload = {};
        if (createSelectedS3Users.length > 0) {
          associationsPayload.s3_user_ids = createSelectedS3Users;
        }
        if (createSelectedS3Connections.length > 0) {
          associationsPayload.s3_connection_ids = createSelectedS3Connections;
        }
        if (Object.keys(associationsPayload).length > 0) {
          await updateUser(created.id, associationsPayload);
        }
      }
      setActionMessage("User created");
      setForm(createFormTemplate());
      setCreateSelectedS3Accounts([]);
      setCreateSelectedS3Users([]);
      setCreateSelectedS3Connections([]);
      setCreateAccountRoleChoice({});
      setCreateAccountAdminChoice({});
      setCreateS3AccountSearch("");
      setCreateS3Search("");
      setCreateConnectionSearch("");
      setCreateAccountSelections([]);
      setCreateS3UserSelections([]);
      setCreateConnectionSelections([]);
      setShowCreateAccountPanel(false);
      setShowCreateS3UserPanel(false);
      setShowCreateConnectionPanel(false);
      setCreateAssociationsTab("accounts");
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
      setShowCreateModal(false);
    } catch (err) {
      setActionError(extractError(err));
    }
  };

  const startEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      password: "",
      role: normalizeUiRoleValue(user.role),
    });
    const accountRoles = new Map<number, string | null>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
    );
    const accountAdmins = new Map<number, boolean>(
      (user.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
    );
    const selectedAccounts =
      user.accounts?.map((id) => ({
        id: Number(id),
        role: accountRoles.get(Number(id)) ?? "portal_none",
        account_admin: portalEnabled ? accountAdmins.get(Number(id)) ?? false : true,
      })) ?? [];
    setEditSelectedS3Accounts(selectedAccounts);
    setEditSelectedS3Users(user.s3_users ? user.s3_users.map((id) => Number(id)) : []);
    setEditSelectedS3Connections(user.s3_connections ? user.s3_connections.map((id) => Number(id)) : []);
    setEditS3AccountSearch("");
    setEditS3Search("");
    setEditConnectionSearch("");
    const hasAccounts = selectedAccounts.length > 0;
    const hasS3Users = Boolean(user.s3_users && user.s3_users.length > 0);
    const hasConnections = Boolean(user.s3_connections && user.s3_connections.length > 0);
    if (hasAccounts) {
      setEditAssociationsTab("accounts");
    } else if (hasS3Users) {
      setEditAssociationsTab("s3_users");
    } else if (hasConnections) {
      setEditAssociationsTab("connections");
    } else {
      setEditAssociationsTab("accounts");
    }
    setShowEditAccountPanel(false);
    setShowEditS3UserPanel(false);
    setShowEditConnectionPanel(false);
    setEditAccountSelections([]);
    setEditS3UserSelections([]);
    setEditConnectionSelections([]);
    setActionError(null);
    setActionMessage(null);
    setShowEditModal(true);
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setBusyId(editingUser.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const payload: UpdateUserPayload = {};
      if (editForm.email) {
        payload.email = editForm.email;
      }
      if (editForm.password) {
        payload.password = editForm.password;
      }
      if (editForm.role) {
        payload.role = editForm.role;
      }
      payload.s3_user_ids = editSelectedS3Users;
      payload.s3_connection_ids = editSelectedS3Connections;
      await updateUser(editingUser.id, payload);
      const existing = editingUser.accounts ? editingUser.accounts.map((id) => Number(id)) : [];
      const existingRoleById = new Map<number, string | null>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), link.account_role ?? null])
      );
      const existingAdminById = new Map<number, boolean>(
        (editingUser.account_links ?? []).map((link) => [Number(link.account_id), Boolean(link.account_admin)])
      );
      const selectedIds = editSelectedS3Accounts.map((entry) => Number(entry.id));
      const toAdd = editSelectedS3Accounts.filter((entry) => !existing.includes(Number(entry.id)));
      const toRemove = existing.filter((id) => !selectedIds.includes(id));
      const toUpdateRole = editSelectedS3Accounts.filter((entry) => {
        const currentRole = existingRoleById.get(Number(entry.id)) ?? "portal_none";
        const currentAdmin = existingAdminById.get(Number(entry.id)) ?? false;
        return existing.includes(Number(entry.id)) && (currentRole !== entry.role || currentAdmin !== Boolean(entry.account_admin));
      });

      if (toAdd.length > 0) {
        await Promise.all(
          toAdd.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              portalEnabled ? entry.role : undefined,
              portalEnabled ? entry.account_admin ?? entry.role === "portal_manager" : true
            )
          )
        );
      }
      if (toUpdateRole.length > 0) {
        await Promise.all(
          toUpdateRole.map((entry) =>
            assignUserToS3Account(
              editingUser.id,
              Number(entry.id),
              portalEnabled ? entry.role : undefined,
              portalEnabled ? entry.account_admin ?? entry.role === "portal_manager" : true
            )
          )
        );
      }
      for (const accountId of toRemove) {
        const account = accountOptionsById.get(Number(accountId));
        if (!account) continue;
        const remainingLinks =
          (account.user_links ?? account.user_ids?.map((id) => ({ user_id: id, account_role: null, account_admin: false })) ?? [])
            .filter((link) => link.user_id !== editingUser.id);
        const normalizedLinks = portalEnabled
          ? remainingLinks
          : remainingLinks.map((link) => ({ ...link, account_role: null }));
        await updateS3Account(Number(accountId), { user_links: normalizedLinks });
      }

      setActionMessage("User updated");
      setEditingUser(null);
      setEditForm({});
      setEditSelectedS3Accounts([]);
      setEditSelectedS3Users([]);
      setEditSelectedS3Connections([]);
      setEditS3AccountSearch("");
      setEditS3Search("");
      setEditConnectionSearch("");
      setEditAssociationsTab("accounts");
      setShowEditAccountPanel(false);
      setShowEditS3UserPanel(false);
      setShowEditConnectionPanel(false);
      setEditAccountSelections([]);
      setEditS3UserSelections([]);
      setEditConnectionSelections([]);
      setShowEditModal(false);
      await fetchUsers();
      if (s3AccountsLoaded) {
        await fetchS3Accounts();
      }
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (userId: number) => {
    const confirmDelete = window.confirm("Delete this user?");
    if (!confirmDelete) return;
    setBusyId(userId);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteUser(userId);
      setActionMessage("User deleted");
      await fetchUsers();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setBusyId(null);
    }
  };

  const usersDescription = "Create, edit, delete, and link UI users to RGW accounts, S3 users, and S3 connections.";
  const associationLabel = "S3 Accounts / Users / Connections";
  const filterPlaceholder = "Search by email, role, account, user, or connection";

  return (
    <div className="space-y-4">
      <PageHeader
        title="UI Users"
        description={usersDescription}
        breadcrumbs={[{ label: "Admin" }, { label: "Interface" }, { label: "UI Users" }]}
        actions={[
          {
            label: "Create user",
            onClick: () => {
              setCreateAssociationsTab("accounts");
              setShowCreateModal(true);
            },
          },
        ]}
      />
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {showCreateModal && (
        <Modal
          title="Create user"
          onClose={() => {
            setShowCreateModal(false);
            setForm(createFormTemplate());
            setCreateSelectedS3Accounts([]);
            setCreateSelectedS3Users([]);
            setCreateSelectedS3Connections([]);
            setCreateAccountRoleChoice({});
            setCreateAccountAdminChoice({});
            setCreateS3AccountSearch("");
            setCreateS3Search("");
            setCreateConnectionSearch("");
            setCreateAssociationsTab("accounts");
            setShowCreateAccountPanel(false);
            setShowCreateS3UserPanel(false);
            setShowCreateConnectionPanel(false);
            setCreateAccountSelections([]);
            setCreateS3UserSelections([]);
            setCreateConnectionSelections([]);
          }}
        >
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Email *</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane.doe@example.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Password *</label>
              <input
                type="password"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="•••••••"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Role</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.role}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({
                    ...f,
                    role: value,
                  }));
                }}
              >
                <option value="ui_none">No access</option>
                <option value="ui_user">User</option>
                <option value="ui_admin">Admin</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <AssociationsTabs
                activeTab={createAssociationsTab}
                onTabChange={(nextTab) => {
                  setCreateAssociationsTab(nextTab);
                  setShowCreateAccountPanel(false);
                  setShowCreateS3UserPanel(false);
                  setShowCreateConnectionPanel(false);
                }}
                portalEnabled={portalEnabled}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                accounts={{
                  selected: createSelectedS3Accounts,
                  setSelected: setCreateSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableCreateS3Accounts,
                  visible: visibleCreateS3Accounts,
                  search: createS3AccountSearch,
                  setSearch: setCreateS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showCreateAccountPanel,
                  setShowPanel: setShowCreateAccountPanel,
                  selections: createAccountSelections,
                  setSelections: setCreateAccountSelections,
                  roleChoice: createAccountRoleChoice,
                  setRoleChoice: setCreateAccountRoleChoice,
                  adminChoice: createAccountAdminChoice,
                  setAdminChoice: setCreateAccountAdminChoice,
                  toggleSelection: toggleCreateAccountSelection,
                }}
                s3Users={{
                  selected: createSelectedS3Users,
                  setSelected: setCreateSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableCreateS3Users,
                  visible: visibleCreateS3Users,
                  search: createS3Search,
                  setSearch: setCreateS3Search,
                  loading: s3UsersLoading,
                  showPanel: showCreateS3UserPanel,
                  setShowPanel: setShowCreateS3UserPanel,
                  selections: createS3UserSelections,
                  setSelections: setCreateS3UserSelections,
                  toggleSelection: toggleCreateS3UserSelection,
                }}
                connections={{
                  selected: createSelectedS3Connections,
                  setSelected: setCreateSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableCreateS3Connections,
                  visible: visibleCreateS3Connections,
                  search: createConnectionSearch,
                  setSearch: setCreateConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showCreateConnectionPanel,
                  setShowPanel: setShowCreateConnectionPanel,
                  selections: createConnectionSelections,
                  setSelections: setCreateConnectionSelections,
                  toggleSelection: toggleCreateConnectionSelection,
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setForm(createFormTemplate());
                  setCreateSelectedS3Accounts([]);
                  setCreateS3AccountSearch("");
                  setCreateSelectedS3Users([]);
                  setCreateS3Search("");
                  setCreateSelectedS3Connections([]);
                  setCreateConnectionSearch("");
                  setCreateAccountRoleChoice({});
                  setCreateAccountAdminChoice({});
                  setCreateAssociationsTab("accounts");
                  setShowCreateAccountPanel(false);
                  setShowCreateS3UserPanel(false);
                  setShowCreateConnectionPanel(false);
                  setCreateAccountSelections([]);
                  setCreateS3UserSelections([]);
                  setCreateConnectionSelections([]);
                }}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">UI Users</p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {totalUsers} entr{totalUsers === 1 ? "y" : "ies"} · search matches all records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              placeholder={filterPlaceholder}
              className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
        <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                    {[
                      { label: "Email", field: "email" as SortField },
                      { label: "Role", field: "role" as SortField },
                      { label: "Last login", field: "last_login_at" as SortField },
                      { label: associationLabel, field: "accounts" as SortField },
                      { label: "Actions", field: null as SortField | null },
                    ].map((col) => (
                  <th
                    key={col.label}
                    onClick={col.field ? () => toggleSort(col.field) : undefined}
                    className={`px-6 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
                      col.field ? "cursor-pointer hover:text-primary-700 dark:hover:text-primary-100" : "text-right"
                    }`}
                  >
                    <div className={`flex items-center ${col.label === "Actions" ? "justify-end" : "gap-1"}`}>
                      <span>{col.label}</span>
                      {col.field && sort.field === col.field && (
                        <span className="ui-caption">{sort.direction === "asc" ? "▲" : "▼"}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    Loading...
                  </td>
                </tr>
              )}
              {error && !loading && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-rose-600 dark:text-rose-200">
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && totalUsers === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-4 ui-body text-slate-500 dark:text-slate-400">
                    No users.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(user)}
                          className="w-full text-left transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:text-primary-100"
                        >
                          {user.email}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{displayUiRole(user.role)}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {formatLastLogin(user.last_login_at)}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {renderAssociationSummary(user)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => startEdit(user)} className={tableActionButtonClasses}>
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className={tableDeleteActionClasses}
                          disabled={busyId === user.id}
                        >
                          {busyId === user.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={totalUsers}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          disabled={loading}
        />
      </div>

      {editingUser && showEditModal && (
        <Modal
          title="Edit user"
          onClose={() => {
            setShowEditModal(false);
            setEditingUser(null);
            setEditSelectedS3Accounts([]);
            setEditS3AccountSearch("");
            setEditSelectedS3Users([]);
            setEditS3Search("");
            setEditSelectedS3Connections([]);
            setEditConnectionSearch("");
            setEditAssociationsTab("accounts");
            setShowEditAccountPanel(false);
            setShowEditS3UserPanel(false);
            setShowEditConnectionPanel(false);
            setEditAccountSelections([]);
            setEditS3UserSelections([]);
            setEditConnectionSelections([]);
            setEditForm({});
          }}
        >
          <p className="ui-body text-slate-500 mb-3">{editingUser.email}</p>
          {actionError && (
            <PageBanner tone="error" className="mb-3">
              {actionError}
            </PageBanner>
          )}
          {actionMessage && (
            <PageBanner tone="success" className="mb-3">
              {actionMessage}
            </PageBanner>
          )}
          <form onSubmit={submitEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Email</label>
              <input
                type="email"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editForm.email ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">New password</label>
              <input
                type="password"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editForm.password ?? ""}
                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to keep current"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="ui-body font-medium text-slate-700">Role</label>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={editRoleValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditForm((f) => ({
                    ...f,
                    role: value,
                  }));
                }}
              >
                <option value="ui_none">No access</option>
                <option value="ui_user">User</option>
                <option value="ui_admin">Admin</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <AssociationsTabs
                activeTab={editAssociationsTab}
                onTabChange={(nextTab) => {
                  setEditAssociationsTab(nextTab);
                  setShowEditAccountPanel(false);
                  setShowEditS3UserPanel(false);
                  setShowEditConnectionPanel(false);
                }}
                portalEnabled={portalEnabled}
                maxVisibleOptions={MAX_VISIBLE_OPTIONS}
                accounts={{
                  selected: editSelectedS3Accounts,
                  setSelected: setEditSelectedS3Accounts,
                  optionsById: accountOptionsById,
                  available: availableEditS3Accounts,
                  visible: visibleEditS3Accounts,
                  search: editS3AccountSearch,
                  setSearch: setEditS3AccountSearch,
                  loading: s3AccountsLoading,
                  showPanel: showEditAccountPanel,
                  setShowPanel: setShowEditAccountPanel,
                  selections: editAccountSelections,
                  setSelections: setEditAccountSelections,
                  roleChoice: editAccountRoleChoice,
                  setRoleChoice: setEditAccountRoleChoice,
                  adminChoice: editAccountAdminChoice,
                  setAdminChoice: setEditAccountAdminChoice,
                  toggleSelection: toggleEditAccountSelection,
                }}
                s3Users={{
                  selected: editSelectedS3Users,
                  setSelected: setEditSelectedS3Users,
                  labelById: s3UserLabelById,
                  available: availableEditS3Users,
                  visible: visibleEditS3Users,
                  search: editS3Search,
                  setSearch: setEditS3Search,
                  loading: s3UsersLoading,
                  showPanel: showEditS3UserPanel,
                  setShowPanel: setShowEditS3UserPanel,
                  selections: editS3UserSelections,
                  setSelections: setEditS3UserSelections,
                  toggleSelection: toggleEditS3UserSelection,
                }}
                connections={{
                  selected: editSelectedS3Connections,
                  setSelected: setEditSelectedS3Connections,
                  labelById: s3ConnectionLabelById,
                  available: availableEditS3Connections,
                  visible: visibleEditS3Connections,
                  search: editConnectionSearch,
                  setSearch: setEditConnectionSearch,
                  loading: s3ConnectionsLoading,
                  showPanel: showEditConnectionPanel,
                  setShowPanel: setShowEditConnectionPanel,
                  selections: editConnectionSelections,
                  setSelections: setEditConnectionSelections,
                  toggleSelection: toggleEditConnectionSelection,
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-3 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                  setEditSelectedS3Accounts([]);
                  setEditS3AccountSearch("");
                  setEditSelectedS3Users([]);
                  setEditS3Search("");
                  setEditSelectedS3Connections([]);
                  setEditConnectionSearch("");
                  setEditAssociationsTab("accounts");
                  setShowEditAccountPanel(false);
                  setShowEditS3UserPanel(false);
                  setShowEditConnectionPanel(false);
                  setEditAccountSelections([]);
                  setEditS3UserSelections([]);
                  setEditConnectionSelections([]);
                  setEditForm({});
                }}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyId === editingUser.id}
                className="rounded-md bg-primary px-4 py-2 ui-body font-medium text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
              >
                {busyId === editingUser.id ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
