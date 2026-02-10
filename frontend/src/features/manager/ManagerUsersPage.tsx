/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useS3AccountContext } from "./S3AccountContext";
import { S3AccountSelector } from "../../api/accountParams";
import {
  AccessKey,
  IAMUser,
  createIamUser,
  deleteIamUser,
  listIamUsers,
} from "../../api/managerIamUsers";
import { IAMGroup, listIamGroups } from "../../api/managerIamGroups";
import { IamPolicy, InlinePolicy, listIamPolicies } from "../../api/managerIamPolicies";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import Modal from "../../components/Modal";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactInputClasses } from "../../components/toolbarControlClasses";
import { confirmDeletion } from "../../utils/confirm";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";

export default function ManagerUsersPage() {
  type SortField = keyof IAMUser;

  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  if (isS3User) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Users"
          description="Manage RGW IAM identities for your account."
          breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Users" }]}
        />
        <PageBanner tone="info">IAM is not available for standalone S3 users. Select an S3 Account (tenant) to continue.</PageBanner>
      </div>
    );
  }
  const [users, setUsers] = useState<IAMUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedName, setAdvancedName] = useState("");
  const [createKey, setCreateKey] = useState(true);
  const [createdKey, setCreatedKey] = useState<AccessKey | null>(null);
  const [createdForUser, setCreatedForUser] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [groups, setGroups] = useState<IAMGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [inlineDraftName, setInlineDraftName] = useState("");
  const [inlinePolicyText, setInlinePolicyText] = useState("");
  const [inlineDrafts, setInlineDrafts] = useState<InlinePolicy[]>([]);
  const [filter, setFilter] = useState("");
  const [showGroupOptions, setShowGroupOptions] = useState(false);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });

  const userTableColumns: { label: string; field?: SortField | null; align?: "left" | "right" }[] = [
    { label: "Name", field: "name" },
    { label: "ARN", field: "arn" },
    { label: "Groups", field: null },
    { label: "Policies", field: null },
    { label: "Actions", field: null, align: "right" },
  ];

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

  const load = async (accountId: S3AccountSelector) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIamUsers(accountId);
      setUsers(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async (accountId: S3AccountSelector) => {
    try {
      const data = await listIamGroups(accountId);
      setGroups(data);
    } catch (err) {
      setError(extractError(err));
    }
  };

  const loadPolicies = async (accountId: S3AccountSelector) => {
    try {
      const data = await listIamPolicies(accountId);
      setPolicies(data);
    } catch (err) {
      setError(extractError(err));
    }
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setUsers([]);
      setGroups([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadGroups(accountIdForApi);
    loadPolicies(accountIdForApi);
    setSelectedGroups([]);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowGroupOptions(false);
    setShowPolicyOptions(false);
    setInlineDrafts([]);
    setInlineDraftName("");
    setInlinePolicyText("");
  }, [accountIdForApi, needsS3AccountSelection]);

  useEffect(() => {
    setSelectedPolicies((prev) => prev.filter((arn) => policies.some((p) => p.arn === arn)));
  }, [policies]);

  useEffect(() => {
    if (selectedGroups.length > 0) {
      setShowGroupOptions(true);
    }
  }, [selectedGroups.length]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const filteredUsers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const items = query
      ? users.filter((u) => u.name.toLowerCase().includes(query) || (u.arn ?? "").toLowerCase().includes(query))
      : users;
    const sorted = [...items].sort((a, b) => {
      const aVal = (a as any)[sort.field];
      const bVal = (b as any)[sort.field];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sort.direction === "asc" ? 1 : -1;
      if (bVal == null) return sort.direction === "asc" ? -1 : 1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sort.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return sort.direction === "asc" ? diff : -diff;
    });
    return sorted;
  }, [users, filter, sort]);

  const filteredPolicies = useMemo(() => {
    const query = policySearch.trim().toLowerCase();
    if (!query) return policies;
    return policies.filter((p) => {
      const name = p.name.toLowerCase();
      const arn = p.arn.toLowerCase();
      return name.includes(query) || arn.includes(query);
    });
  }, [policies, policySearch]);

  const toggleSort = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
  };

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !advancedName.trim()) return;
    setBusy(advancedName);
    setError(null);
    setActionMessage(null);
    setCreatedKey(null);
    setCreatedForUser(null);
    try {
      const created = await createIamUser(
        accountIdForApi,
        advancedName.trim(),
        createKey,
        selectedGroups,
        selectedPolicies,
        inlineDrafts
      );
      setAdvancedName("");
      setSelectedGroups([]);
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowGroupOptions(false);
      setShowPolicyOptions(false);
      setInlineDrafts([]);
      setInlineDraftName("");
      setInlinePolicyText("");
      setShowAdvancedModal(false);
      if (createKey && created.access_key) {
        setCreatedKey(created.access_key);
        setCreatedForUser(created.name);
      }
      setActionMessage("User created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (needsS3AccountSelection) return;
    if (!confirmDeletion("user", name)) return;
    setBusy(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamUser(accountIdForApi, name);
      setActionMessage("User deleted");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const openAdvancedModal = () => {
    setShowAdvancedModal(true);
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setInlineDrafts([]);
    setInlineDraftName("");
    setInlinePolicyText("");
  };

  const handleAddInlineDraft = () => {
    if (!inlineDraftName.trim()) {
      setError("Inline policy name is required.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = inlinePolicyText.trim() ? JSON.parse(inlinePolicyText) : {};
    } catch {
      setError("Inline policy must be valid JSON.");
      return;
    }
    setInlineDrafts((prev) => {
      const filtered = prev.filter((p) => p.name !== inlineDraftName.trim());
      return [...filtered, { name: inlineDraftName.trim(), document: parsed }];
    });
    setInlinePolicyText(JSON.stringify(parsed, null, 2));
    setError(null);
  };

  const handleLoadInlineDraft = (name: string) => {
    const draft = inlineDrafts.find((p) => p.name === name);
    if (!draft) return;
    try {
      setInlinePolicyText(JSON.stringify(draft.document ?? {}, null, 2));
    } catch {
      setInlinePolicyText("");
    }
    setInlineDraftName(draft.name);
  };

  const handleRemoveInlineDraft = (name: string) => {
    setInlineDrafts((prev) => prev.filter((p) => p.name !== name));
    if (inlineDraftName === name) {
      setInlineDraftName("");
      setInlinePolicyText("");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        description="Create/delete via the account root credentials. Optionally generate an access key on creation."
        breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Users" }]}
        actions={[
          {
            label: "Create user",
            onClick: openAdvancedModal,
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {needsS3AccountSelection && <PageBanner tone="warning">Select an account before creating or listing users.</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdForUser && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Key created for {createdForUser}</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">
                Copy these values now; the secret will only be shown once.
              </p>
            </div>
            <Link
              to={`/manager/users/${encodeURIComponent(createdForUser)}/keys`}
              className="ui-body font-medium text-primary hover:text-sky-600 dark:text-primary-200 dark:hover:text-primary-100"
            >
              Manage keys
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600 dark:text-amber-300">Access key</div>
              <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                {createdKey.access_key_id}
              </div>
            </div>
            <div>
              <div className="ui-caption uppercase tracking-wide text-amber-600 dark:text-amber-300">Secret key</div>
              <div className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                {createdKey.secret_access_key ?? "Not provided"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Users</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">List plus key/policy actions.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="ui-caption text-slate-500 dark:text-slate-400">{filteredUsers.length} user(s)</span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by name or ARN"
                  className={`${toolbarCompactInputClasses} w-full sm:w-64 md:w-72`}
                />
              </div>
            </div>
          </div>
        </div>
        <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              {userTableColumns.map((col) => (
                <SortableHeader
                  key={col.label}
                  label={col.label}
                  field={col.field}
                  activeField={sort.field}
                  direction={sort.direction}
                  align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                  onSort={col.field ? (field) => toggleSort(field as SortField) : undefined}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading && <TableEmptyState colSpan={userTableColumns.length} message="Loading users..." />}
            {error && !loading && filteredUsers.length === 0 && (
              <TableEmptyState colSpan={userTableColumns.length} message="Unable to load users." />
            )}
            {!loading && !error && filteredUsers.length === 0 && (
              <TableEmptyState colSpan={userTableColumns.length} message="No users." />
            )}
            {!loading &&
              filteredUsers.map((u) => {
                const hasGroups = (u.groups?.length ?? 0) > 0;
                const hasPolicies = (u.policies?.length ?? 0) > 0;
                const hasInlinePolicies = (u.inline_policies?.length ?? 0) > 0;
                const lacksGroupOrPolicy = !hasGroups && !hasPolicies && !hasInlinePolicies;
                const lacksKeys = u.has_keys === false;
                const showWarning = lacksGroupOrPolicy || lacksKeys;
                const warningTitle = (() => {
                  if (lacksGroupOrPolicy && lacksKeys) {
                    return "No groups/policies or access keys assigned";
                  }
                  if (lacksGroupOrPolicy) {
                    return "No groups or policies assigned";
                  }
                  return "No access keys registered";
                })();

                return (
                  <tr key={u.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <span>{u.name}</span>
                        {showWarning && (
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-100"
                            title={warningTitle}
                            role="img"
                            aria-label="Warning: user might lack necessary permissions"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.6}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path d="M12 4 3 20h18L12 4z" />
                              <path d="M12 9v5" />
                              <path d="M12 17h.01" strokeWidth={2.4} />
                            </svg>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{u.arn ?? "-"}</td>
                    <td className="manager-table-cell-wide px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {hasGroups ? (
                        <div className="flex flex-wrap gap-2">
                          {u.groups?.map((g) => (
                            <span
                              key={g}
                              className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
                      )}
                    </td>
                    <td className="manager-table-cell-wide px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {hasPolicies ? (
                        <div className="flex flex-wrap gap-2">
                          {u.policies?.map((p) => (
                            <span
                              key={p}
                              className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              title={p}
                            >
                              {p.split("/").pop()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          to={`/manager/users/${encodeURIComponent(u.name)}/keys`}
                          className={tableActionButtonClasses}
                        >
                          Keys
                        </Link>
                        <Link
                          to={`/manager/users/${encodeURIComponent(u.name)}/policies`}
                          className={tableActionButtonClasses}
                        >
                          Policies
                        </Link>
                        <button
                          onClick={() => handleDelete(u.name)}
                          className={tableDeleteActionClasses}
                          disabled={busy === u.name}
                        >
                          {busy === u.name ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {showAdvancedModal && (
        <Modal title="Create IAM user" onClose={closeAdvancedModal}>
          <form className="space-y-4" onSubmit={handleAdvancedCreate}>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">User name</label>
              <input
                type="text"
                value={advancedName}
                onChange={(e) => setAdvancedName(e.target.value)}
                placeholder="User name"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
            </div>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={createKey}
                onChange={(e) => setCreateKey(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
              />
              Auto-generate an access key (shown only once)
            </label>
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Add to groups (optional)</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Launch permissions by linking groups before creation.</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedGroups.length > 0 && (
                    <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {selectedGroups.length} selected
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowGroupOptions((prev) => !prev)}
                    className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    {showGroupOptions ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {showGroupOptions && (
                <div className="flex flex-wrap gap-2">
                  {groups.length === 0 && <span className="ui-body text-slate-500 dark:text-slate-400">No groups available.</span>}
                  {groups.map((g) => {
                    const checked = selectedGroups.includes(g.name);
                    return (
                      <label
                        key={g.name}
                        className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroups((prev) => [...prev, g.name]);
                            } else {
                              setSelectedGroups((prev) => prev.filter((name) => name !== g.name));
                            }
                          }}
                        />
                        {g.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Attach policies (optional)</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Bind JSON policies now or skip and attach later.</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedPolicies.length > 0 && (
                    <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {selectedPolicies.length} selected
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPolicyOptions((prev) => !prev)}
                    className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    {showPolicyOptions ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {showPolicyOptions && (
                <>
                  {policies.length === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No policies available. Create them in the Policies tab.</p>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={policySearch}
                        onChange={(e) => setPolicySearch(e.target.value)}
                        placeholder="Search policies by name or ARN"
                        className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div className="flex flex-wrap gap-2">
                        {filteredPolicies.length === 0 && (
                          <span className="ui-caption text-slate-500 dark:text-slate-400">No matching policies.</span>
                        )}
                        {filteredPolicies.map((policy) => {
                          const checked = selectedPolicies.includes(policy.arn);
                          return (
                            <label
                              key={policy.arn}
                              className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              title={policy.arn}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPolicies((prev) => [...prev, policy.arn]);
                                  } else {
                                    setSelectedPolicies((prev) => prev.filter((arn) => arn !== policy.arn));
                                  }
                                }}
                              />
                              <span>{policy.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Policies must be created first in the Policies tab.</p>
                </>
              )}
            </div>
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Inline policies (optional)</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Create inline JSON policies to embed directly on the user during creation.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {inlineDrafts.length > 0 && (
                    <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {inlineDrafts.length} saved
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setInlineDrafts([]);
                      setInlineDraftName("");
                      setInlinePolicyText("");
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Inline policy name</label>
                  <input
                    type="text"
                    value={inlineDraftName}
                    onChange={(e) => setInlineDraftName(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="inline-policy"
                  />
                  {inlineDrafts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {inlineDrafts.map((draft) => (
                        <span
                          key={draft.name}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <button type="button" onClick={() => handleLoadInlineDraft(draft.name)} className="underline">
                            {draft.name}
                          </button>
                          <button
                            type="button"
                            className="text-rose-600 hover:text-rose-700 dark:text-rose-200 dark:hover:text-rose-100"
                            onClick={() => handleRemoveInlineDraft(draft.name)}
                            aria-label={`Remove inline policy ${draft.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Inline policy document</label>
                  <textarea
                    value={inlinePolicyText}
                    onChange={(e) => setInlinePolicyText(e.target.value)}
                    className="min-h-[140px] w-full rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    spellCheck={false}
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Provide valid JSON. Blank defaults to an empty document.</p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInlinePolicyText(DEFAULT_INLINE_POLICY_TEXT)}
                  className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                >
                  Insert template
                </button>
                <button
                  type="button"
                  onClick={handleAddInlineDraft}
                  className="rounded-full bg-primary px-4 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
                >
                  Add/Update inline policy
                </button>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Attach policies (optional)</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Bind JSON policies now or skip and attach later.</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedPolicies.length > 0 && (
                    <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {selectedPolicies.length} selected
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPolicyOptions((prev) => !prev)}
                    className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    {showPolicyOptions ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {showPolicyOptions && (
                <>
                  {policies.length === 0 ? (
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No policies available. Create them in the Policies tab.</p>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={policySearch}
                        onChange={(e) => setPolicySearch(e.target.value)}
                        placeholder="Search policies by name or ARN"
                        className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div className="flex flex-wrap gap-2">
                        {filteredPolicies.length === 0 && (
                          <span className="ui-caption text-slate-500 dark:text-slate-400">No matching policies.</span>
                        )}
                        {filteredPolicies.map((policy) => {
                          const checked = selectedPolicies.includes(policy.arn);
                          return (
                            <label
                              key={policy.arn}
                              className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              title={policy.arn}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPolicies((prev) => [...prev, policy.arn]);
                                  } else {
                                    setSelectedPolicies((prev) => prev.filter((arn) => arn !== policy.arn));
                                  }
                                }}
                              />
                              <span>{policy.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Policies must be created first in the Policies tab.</p>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeAdvancedModal}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={needsS3AccountSelection || busy !== null}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {busy === advancedName ? "Creating..." : "Create user"}
              </button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}
