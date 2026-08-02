/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
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
import ListPageSection from "../../components/list/ListPageSection";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import ManagerTable, {
  managerTableActionCellClass,
  managerTableCellClass,
  managerTablePrimaryCellClass,
  managerTableWideCellClass,
  type ManagerTableColumn,
} from "../../components/list/ManagerTable";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { extractApiError } from "../../utils/apiError";
import { confirmDeletion } from "../../utils/confirm";
import { stableSignature } from "../../utils/stableSignature";
import { compareByNullableField, type SortableField } from "../../utils/sortValues";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyDraftEditor, { type InlinePolicyDraftEditorMode } from "./InlinePolicyDraftEditor";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import CreateManagedPrivateAccessModal from "./CreateManagedPrivateAccessModal";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerUsersPage() {
  type SortField = SortableField<IAMUser>;

  const {
    selectedS3AccountType,
    accountIdForApi,
    requiresS3AccountSelection,
    accessMode,
    managerPrivateAccessEnabled,
  } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
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
  const [selectedInlineDraftName, setSelectedInlineDraftName] = useState<string | null>(null);
  const [inlineDraftMode, setInlineDraftMode] = useState<InlinePolicyDraftEditorMode>("create");
  const [showInlinePolicyOptions, setShowInlinePolicyOptions] = useState(false);
  const [showPrivateAccessModal, setShowPrivateAccessModal] = useState(false);
  const [filter, setFilter] = useState("");
  const [showGroupOptions, setShowGroupOptions] = useState(false);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({
      advancedName: "",
      createKey: true,
      selectedGroups: [],
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" }>({
    field: "name",
    direction: "asc",
  });

  const userTableColumns: Array<ManagerTableColumn<SortField>> = [
    { key: "name", label: "Name", sortField: "name", mobileRole: "primary" },
    { key: "arn", label: "ARN", sortField: "arn" },
    { key: "groups", label: "Groups" },
    { key: "policies", label: "Policies" },
    { key: "actions", label: "Actions", align: "right", mobileRole: "actions" },
  ];

  const load = useCallback(async (accountId: S3AccountSelector) => {
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
  }, []);

  const loadGroups = useCallback(async (accountId: S3AccountSelector) => {
    try {
      const data = await listIamGroups(accountId);
      setGroups(data);
    } catch (err) {
      setError(extractError(err));
    }
  }, []);

  const loadPolicies = useCallback(async (accountId: S3AccountSelector) => {
    try {
      const data = await listIamPolicies(accountId);
      setPolicies(data);
    } catch (err) {
      setError(extractError(err));
    }
  }, []);

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
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
  }, [accountIdForApi, accessMode, load, loadGroups, loadPolicies, needsS3AccountSelection]);

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
      return compareByNullableField(a, b, sort.field, sort.direction);
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
  const advancedCurrentSignature = useMemo(
    () =>
      stableSignature({
        advancedName,
        createKey,
        selectedGroups,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [
      advancedName,
      createKey,
      inlineDraftName,
      inlineDrafts,
      inlinePolicyText,
      selectedGroups,
      selectedPolicies,
    ]
  );
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredUsers.length,
  });

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
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode("create");
      setShowInlinePolicyOptions(false);
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
    setError(null);
    setAdvancedName("");
    setCreateKey(true);
    setSelectedGroups([]);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowGroupOptions(false);
    setShowPolicyOptions(false);
    setInlineDrafts([]);
    setShowAdvancedModal(true);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
    setAdvancedInitialSignature(
      stableSignature({
        advancedName: "",
        createKey: true,
        selectedGroups: [],
        selectedPolicies: [],
        inlineDrafts: [],
        inlineDraftName: "",
        inlinePolicyText: "",
      })
    );
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setAdvancedName("");
    setCreateKey(true);
    setSelectedGroups([]);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowGroupOptions(false);
    setShowPolicyOptions(false);
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
  };

  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: busy !== null,
  });

  const handleAddInlineDraft = () => {
    const trimmedName = inlineDraftName.trim();
    if (!trimmedName) {
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
      const filtered = prev.filter((policy) => policy.name !== trimmedName && policy.name !== selectedInlineDraftName);
      return [...filtered, { name: trimmedName, document: parsed }];
    });
    setSelectedInlineDraftName(trimmedName);
    setInlineDraftName(trimmedName);
    setInlinePolicyText(JSON.stringify(parsed, null, 2));
    setInlineDraftMode("edit");
    setError(null);
  };

  const handleSelectInlineDraft = (name: string | null) => {
    if (!name) {
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode(inlineDrafts.length > 0 ? "idle" : "create");
      setError(null);
      return;
    }
    const draft = inlineDrafts.find((policy) => policy.name === name);
    if (!draft) return;
    try {
      setInlinePolicyText(JSON.stringify(draft.document ?? {}, null, 2));
    } catch {
      setInlinePolicyText("");
    }
    setSelectedInlineDraftName(draft.name);
    setInlineDraftName(draft.name);
    setInlineDraftMode("edit");
    setError(null);
  };

  const handleRemoveInlineDraft = (name: string) => {
    setInlineDrafts((prev) => prev.filter((policy) => policy.name !== name));
    if (selectedInlineDraftName === name || inlineDraftName === name) {
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode(inlineDrafts.length > 1 ? "idle" : "create");
    }
    setError(null);
  };

  const handleCreateInlineDraft = () => {
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setError(null);
  };

  const handleClearInlineDrafts = () => {
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setError(null);
  };

  return (
    <div className={workflowPageHostClass(showAdvancedModal || showPrivateAccessModal)}>
      <PageHeader
        title="Users"
        description="Create/delete via the account root credentials. Optionally generate an access key on creation."
        breadcrumbs={managerPageBreadcrumbs("users")}
        actions={!needsS3AccountSelection && !isS3User
          ? [
              {
                label: "Create user",
                onClick: openAdvancedModal,
              },
              ...(managerPrivateAccessEnabled
                ? [{ label: "Create my private access", onClick: () => setShowPrivateAccessModal(true), variant: "primary" as const }]
                : []),
            ]
          : []}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {createdKey && createdForUser && (
        <OneTimeSecretPanel
          title={`Key created for ${createdForUser}`}
          description="Copy these values now; the secret will only be shown once."
          values={[
            { label: "Access key", value: createdKey.access_key_id, copyLabel: "Copy" },
            {
              label: "Secret key",
              value: createdKey.secret_access_key ?? "Not provided",
              copyLabel: createdKey.secret_access_key ? "Copy" : undefined,
            },
          ]}
          actions={
            <Link
              to={`/manager/users/${encodeURIComponent(createdForUser)}/keys`}
              className="ui-body font-medium text-primary hover:text-primary-600 dark:text-primary-200 dark:hover:text-primary-100"
            >
              Manage keys
            </Link>
          }
        />
      )}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing IAM users"
          description="Users are created within an execution context. Choose an account to list identities, generate keys, and attach policies."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM users are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage account-level IAM identities."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
            title="Users"
            description="User inventory with group, key, and policy shortcuts."
            countLabel={`${filteredUsers.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={filter}
                onChange={setFilter}
                placeholder="Search by name or ARN"
                className="w-full sm:w-64 md:w-72"
              />
            }
        >
          <ManagerTable
            columns={userTableColumns}
            listState={{
              status: tableStatus,
              loadingMessage: "Loading users...",
              errorMessage: "Unable to load users.",
              emptyMessage: "No users.",
            }}
            responsiveCards
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
          >
            {filteredUsers.map((u) => {
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
                  <td className={managerTablePrimaryCellClass}>
                    <div className="flex items-center gap-2">
                      <span>{u.name}</span>
                      {u.is_private_access_managed && (
                        <span
                          className="rounded border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-100"
                          title="Managed private access identity"
                        >
                          Private access
                        </span>
                      )}
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
                  <td className={managerTableCellClass}>{u.arn ?? "-"}</td>
                  <td className={managerTableWideCellClass}>
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
                  <td className={managerTableWideCellClass}>
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
                  <td className={managerTableActionCellClass}>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link to={`/manager/users/${encodeURIComponent(u.name)}/keys`} className={tableActionButtonClasses}>
                        Keys
                      </Link>
                      <Link to={`/manager/users/${encodeURIComponent(u.name)}/policies`} className={tableActionButtonClasses}>
                        Policies
                      </Link>
                      <button
                        onClick={() => handleDelete(u.name)}
                        className={tableDeleteActionClasses}
                        disabled={busy === u.name || u.is_private_access_managed}
                        title={u.is_private_access_managed ? "Delete the linked private connection instead" : undefined}
                      >
                        {busy === u.name ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </ManagerTable>
        </ListPageSection>
      )}

      {showAdvancedModal && (
        <WorkflowPage
          title="Create IAM user"
          description="Create the identity, attach managed or inline policies, and optionally generate its first access key."
          breadcrumbs={managerPageBreadcrumbs("users", { label: "Create" })}
          backLabel="Back to users"
          onBack={advancedCloseGuard.requestClose}
          width="standard"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
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
            <UiCheckboxField
              checked={createKey}
              onChange={(e) => setCreateKey(e.target.checked)}
              className="rounded-md border border-slate-200 px-3 py-2 ui-body text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              Auto-generate an access key (shown only once)
            </UiCheckboxField>
            <div className="space-y-2 rounded-lg border border-dashed border-[color:var(--ui-border)] p-3">
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
                      <UiCheckboxField
                        key={g.name}
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroups((prev) => [...prev, g.name]);
                          } else {
                            setSelectedGroups((prev) => prev.filter((name) => name !== g.name));
                          }
                        }}
                        className="rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {g.name}
                      </UiCheckboxField>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-dashed border-[color:var(--ui-border)] p-3">
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
                            <UiCheckboxField
                              key={policy.arn}
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPolicies((prev) => [...prev, policy.arn]);
                                } else {
                                  setSelectedPolicies((prev) => prev.filter((arn) => arn !== policy.arn));
                                }
                              }}
                              className="rounded border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              labelProps={{ title: policy.arn }}
                            >
                              <span>{policy.name}</span>
                            </UiCheckboxField>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Policies must be created first in the Policies tab.</p>
                </>
              )}
            </div>
            <InlinePolicyDraftEditor
              drafts={inlineDrafts}
              selectedDraftName={selectedInlineDraftName}
              draftName={inlineDraftName}
              draftText={inlinePolicyText}
              entityLabel="user"
              mode={inlineDraftMode}
              expanded={showInlinePolicyOptions}
              onCreateDraft={handleCreateInlineDraft}
              onSelectDraft={handleSelectInlineDraft}
              onDraftNameChange={(value) => {
                setInlineDraftName(value);
                setError(null);
              }}
              onDraftTextChange={(value) => {
                setInlinePolicyText(value);
                setError(null);
              }}
              onSaveDraft={handleAddInlineDraft}
              onRemoveDraft={handleRemoveInlineDraft}
              onClearDrafts={handleClearInlineDrafts}
              onInsertTemplate={() => setInlinePolicyText(DEFAULT_INLINE_POLICY_TEXT)}
              onToggleExpanded={() => setShowInlinePolicyOptions((prev) => !prev)}
            />
            <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={advancedCloseGuard.requestClose}
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
          {advancedCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}

      {showPrivateAccessModal && (
        <CreateManagedPrivateAccessModal
          variant="iam"
          accountId={accountIdForApi}
          groups={groups}
          policies={policies}
          onClose={() => setShowPrivateAccessModal(false)}
          onCreated={(name) => {
            setActionMessage(`Private connection ${name} created without exposing its secret.`);
            setError(null);
          }}
        />
      )}

    </div>
  );
}
