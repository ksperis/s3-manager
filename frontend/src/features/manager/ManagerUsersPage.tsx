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
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { compareByNullableField, nextSortState, type SortableField } from "../../utils/sortValues";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyDraftEditor from "./InlinePolicyDraftEditor";
import ManagedPolicySelectionPanel from "./ManagedPolicySelectionPanel";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import CreateManagedPrivateAccessModal from "./CreateManagedPrivateAccessModal";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerUsersPage() {
  type SortField = SortableField<IAMUser>;
  const deleteConfirmation = useConfirmActionDialog();

  const {
    selectedS3AccountType,
    selectedS3AccountName,
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
  const {
    inlineDraftMode,
    inlineDraftName,
    inlineDrafts,
    inlinePolicyText,
    selectedInlineDraftName,
    showInlinePolicyOptions,
    setInlineDraftName,
    setInlinePolicyText,
    setShowInlinePolicyOptions,
    handleAddInlineDraft,
    handleClearInlineDrafts,
    handleCreateInlineDraft,
    handleRemoveInlineDraft,
    handleSelectInlineDraft,
    resetInlinePolicyDraftEditor,
  } = useInlinePolicyDraftEditor(setError);
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
    resetInlinePolicyDraftEditor();
  }, [
    accountIdForApi,
    accessMode,
    load,
    loadGroups,
    loadPolicies,
    needsS3AccountSelection,
    resetInlinePolicyDraftEditor,
  ]);

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
    setSort((current) => nextSortState(current, field, "desc"));
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
      resetInlinePolicyDraftEditor();
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

  const deleteUser = async (name: string) => {
    if (needsS3AccountSelection) return;
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

  const handleDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete IAM user?",
      description: "Permanently remove this IAM user from the selected account.",
      confirmLabel: "Delete user",
      details: [{ label: "IAM user", value: name }],
      impacts: ["Credentials and permissions attached to this user will no longer grant access."],
      onConfirm: () => deleteUser(name),
    });
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
    resetInlinePolicyDraftEditor();
    setShowAdvancedModal(true);
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
    resetInlinePolicyDraftEditor();
  };

  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: busy !== null,
  });

  const userTableColumns: Array<DataTableColumn<IAMUser, SortField>> = [
    {
      id: "name",
      label: "Name",
      field: "name",
      primary: true,
      mobileRole: "primary",
      render: (user) => {
        const lacksGroupOrPolicy =
          (user.groups?.length ?? 0) === 0 &&
          (user.policies?.length ?? 0) === 0 &&
          (user.inline_policies?.length ?? 0) === 0;
        const lacksKeys = user.has_keys === false;
        const showWarning = lacksGroupOrPolicy || lacksKeys;
        const warningTitle = lacksGroupOrPolicy && lacksKeys
          ? "No groups/policies or access keys assigned"
          : lacksGroupOrPolicy
            ? "No groups or policies assigned"
            : "No access keys registered";

        return (
          <div className="flex items-center gap-2">
            <span>{user.name}</span>
            {user.is_private_access_managed && (
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
        );
      },
    },
    { id: "arn", label: "ARN", field: "arn", render: (user) => user.arn ?? "-" },
    {
      id: "groups",
      label: "Groups",
      cellClassName: "manager-table-cell-wide",
      render: (user) =>
        user.groups && user.groups.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.groups.map((group) => (
              <span
                key={group}
                className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {group}
              </span>
            ))}
          </div>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
        ),
    },
    {
      id: "policies",
      label: "Policies",
      cellClassName: "manager-table-cell-wide",
      render: (user) =>
        user.policies && user.policies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.policies.map((policy) => (
              <span
                key={policy}
                className="rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                title={policy}
              >
                {policy.split("/").pop()}
              </span>
            ))}
          </div>
        ) : (
          <span className="ui-caption text-slate-500 dark:text-slate-400">-</span>
        ),
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (user) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Link to={`/manager/users/${encodeURIComponent(user.name)}/keys`} className={tableActionButtonClasses}>
            Keys
          </Link>
          <Link to={`/manager/users/${encodeURIComponent(user.name)}/policies`} className={tableActionButtonClasses}>
            Policies
          </Link>
          <button
            onClick={() => handleDelete(user.name)}
            className={tableDeleteActionClasses}
            disabled={busy === user.name || user.is_private_access_managed}
            title={user.is_private_access_managed ? "Delete the linked private connection instead" : undefined}
          >
            {busy === user.name ? "Deleting..." : "Delete"}
          </button>
        </div>
      ),
    },
  ];

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
          <DataTableShell
            columns={userTableColumns}
            rows={filteredUsers}
            rowKey={(user) => user.name}
            status={tableStatus}
            loadingMessage="Loading users..."
            errorMessage="Unable to load users."
            emptyMessage="No users."
            responsiveCards
            sort={{ field: sort.field, direction: sort.direction, onSort: toggleSort }}
            tableLayout="fixed"
          />
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
            <ManagedPolicySelectionPanel
              title="Attach policies (optional)"
              description="Bind JSON policies now or skip and attach later."
              emptyMessage="No policies available. Create them in the Policies tab."
              footer="Policies must be created first in the Policies tab."
              policies={policies}
              selectedPolicyArns={selectedPolicies}
              search={policySearch}
              expanded={showPolicyOptions}
              onSearchChange={setPolicySearch}
              onExpandedChange={setShowPolicyOptions}
              onSelectionChange={setSelectedPolicies}
            />
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
          contextName={selectedS3AccountName}
          groups={groups}
          policies={policies}
          onClose={() => setShowPrivateAccessModal(false)}
          onCreated={(name) => {
            setActionMessage(`Private connection ${name} created without exposing its secret.`);
            setError(null);
          }}
        />
      )}

      {deleteConfirmation.confirmationDialog}

    </div>
  );
}
