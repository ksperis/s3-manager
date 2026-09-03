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
  IAMRole,
  attachRolePolicy,
  createIamRole,
  deleteIamRole,
  getIamRole,
  listIamRoles,
  updateIamRole,
} from "../../api/managerIamRoles";
import { IamPolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListPageSection from "../../components/list/ListPageSection";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { useConfirmActionDialog } from "../../components/useConfirmActionDialog";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import WorkflowPage, { workflowPageHostClass } from "../../components/WorkflowPage";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyDraftEditor from "./InlinePolicyDraftEditor";
import ManagedPolicySelectionPanel from "./ManagedPolicySelectionPanel";
import ManagerToolbarSearch from "./ManagerToolbarSearch";
import { useInlinePolicyDraftEditor } from "./useInlinePolicyDraftEditor";
import { useManagerIamCollection } from "./useManagerIamCollection";

const DEFAULT_ASSUME_ROLE_DOCUMENT = JSON.stringify(
  {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: "*" },
        Action: "sts:AssumeRole",
      },
    ],
  },
  null,
  2
);
const DEFAULT_ROLE_PATH = "/";

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerRolesPage() {
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [roleFilter, setRoleFilter] = useState("");
  const {
    error,
    items: roles,
    load,
    loadRelated,
    loading,
    setError,
    setItems: setRoles,
    setLoading,
  } = useManagerIamCollection(listIamRoles);
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
  const [advancedPath, setAdvancedPath] = useState(DEFAULT_ROLE_PATH);
  const [assumeRolePolicyText, setAssumeRolePolicyText] = useState(DEFAULT_ASSUME_ROLE_DOCUMENT);
  const [creating, setCreating] = useState(false);
  const [deletingRole, setDeletingRole] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({
      advancedName: "",
      advancedPath: DEFAULT_ROLE_PATH,
      assumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT,
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRole, setEditingRole] = useState<IAMRole | null>(null);
  const [editPath, setEditPath] = useState(DEFAULT_ROLE_PATH);
  const [editAssumeRolePolicyText, setEditAssumeRolePolicyText] = useState(DEFAULT_ASSUME_ROLE_DOCUMENT);
  const [editInitialSignature, setEditInitialSignature] = useState(() =>
    stableSignature({ editPath: DEFAULT_ROLE_PATH, editAssumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT })
  );
  const [loadingRoleDetails, setLoadingRoleDetails] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadPolicies = useCallback(
    (accountId: S3AccountSelector) =>
      loadRelated(accountId, listIamPolicies, setPolicies),
    [loadRelated],
  );

  useEffect(() => {
    if (needsS3AccountSelection) {
      setRoles([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadPolicies(accountIdForApi);
    resetInlinePolicyDraftEditor();
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor, setLoading, setRoles]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const advancedCurrentSignature = useMemo(
    () =>
      stableSignature({
        advancedName,
        advancedPath,
        assumeRolePolicyText,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [
      advancedName,
      advancedPath,
      assumeRolePolicyText,
      inlineDraftName,
      inlineDrafts,
      inlinePolicyText,
      selectedPolicies,
    ]
  );
  const editCurrentSignature = useMemo(
    () => stableSignature({ editPath, editAssumeRolePolicyText }),
    [editAssumeRolePolicyText, editPath]
  );

  const handleAdvancedCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !advancedName.trim()) return;
    let parsedAssumeDoc: Record<string, unknown>;
    try {
      parsedAssumeDoc = JSON.parse(assumeRolePolicyText);
    } catch {
      setError("Assume role policy must be valid JSON.");
      return;
    }
    const trimmedPath = advancedPath.trim();
    setCreating(true);
    setError(null);
    setActionMessage(null);
    try {
      const roleName = advancedName.trim();
      await createIamRole(accountIdForApi, {
        name: roleName,
        path: trimmedPath === "" ? undefined : trimmedPath,
        assume_role_policy_document: parsedAssumeDoc,
        inline_policies: inlineDrafts,
      });
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachRolePolicy(accountIdForApi, roleName, policy);
          }
        }
      }
      setAdvancedName("");
      setAdvancedPath(DEFAULT_ROLE_PATH);
      setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
      setSelectedPolicies([]);
      setPolicySearch("");
      setShowPolicyOptions(false);
      resetInlinePolicyDraftEditor();
      setShowAdvancedModal(false);
      setActionMessage("Role created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const deleteRole = async (name: string) => {
    if (needsS3AccountSelection) return;
    setDeletingRole(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamRole(accountIdForApi, name);
      setActionMessage("Role deleted");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setDeletingRole(null);
    }
  };

  const handleDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete IAM role?",
      description: "Permanently remove this IAM role from the selected account.",
      confirmLabel: "Delete role",
      details: [{ label: "IAM role", value: name }],
      impacts: ["Workloads that assume this role will no longer receive its permissions."],
      onConfirm: () => deleteRole(name),
    });
  };

  const openAdvancedModal = () => {
    setError(null);
    setAdvancedName("");
    setAdvancedPath(DEFAULT_ROLE_PATH);
    setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
    setShowAdvancedModal(true);
    setAdvancedInitialSignature(
      stableSignature({
        advancedName: "",
        advancedPath: DEFAULT_ROLE_PATH,
        assumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT,
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
    setAdvancedPath(DEFAULT_ROLE_PATH);
    setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
  };

  const formatAssumePolicyText = (document: unknown) => {
    if (!document) return DEFAULT_ASSUME_ROLE_DOCUMENT;
    if (typeof document === "string") {
      try {
        return JSON.stringify(JSON.parse(document), null, 2);
      } catch {
        return document;
      }
    }
    try {
      return JSON.stringify(document, null, 2);
    } catch {
      return DEFAULT_ASSUME_ROLE_DOCUMENT;
    }
  };

  const openEditModal = async (roleName: string) => {
    if (needsS3AccountSelection) return;
    setShowEditModal(true);
    setEditingRole({ name: roleName });
    setLoadingRoleDetails(true);
    setError(null);
    setActionMessage(null);
    try {
      const role = await getIamRole(accountIdForApi, roleName);
      const nextEditPath = role.path ?? DEFAULT_ROLE_PATH;
      const nextAssumeRolePolicyText = formatAssumePolicyText(role.assume_role_policy_document);
      setEditingRole(role);
      setEditPath(nextEditPath);
      setEditAssumeRolePolicyText(nextAssumeRolePolicyText);
      setEditInitialSignature(stableSignature({ editPath: nextEditPath, editAssumeRolePolicyText: nextAssumeRolePolicyText }));
    } catch (err) {
      setError(extractError(err));
      setShowEditModal(false);
      setEditingRole(null);
    } finally {
      setLoadingRoleDetails(false);
    }
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingRole(null);
    setEditAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setEditPath(DEFAULT_ROLE_PATH);
    setEditInitialSignature(stableSignature({ editPath: DEFAULT_ROLE_PATH, editAssumeRolePolicyText: DEFAULT_ASSUME_ROLE_DOCUMENT }));
  };

  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: creating,
  });

  const editCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showEditModal && !loadingRoleDetails && editCurrentSignature !== editInitialSignature,
    onClose: closeEditModal,
    disabled: savingEdit,
  });

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsS3AccountSelection || !editingRole) return;
    let parsedAssumeDoc: Record<string, unknown>;
    try {
      parsedAssumeDoc = JSON.parse(editAssumeRolePolicyText);
    } catch {
      setError("Assume role policy must be valid JSON.");
      return;
    }
    const trimmedPath = editPath.trim();
    setSavingEdit(true);
    setError(null);
    setActionMessage(null);
    try {
      await updateIamRole(accountIdForApi, editingRole.name, {
        path: trimmedPath === "" ? undefined : trimmedPath,
        assume_role_policy_document: parsedAssumeDoc,
      });
      setActionMessage("Role updated");
      closeEditModal();
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const filteredRoles = roles.filter((role) => {
    const needle = roleFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      role.name.toLowerCase().includes(needle) ||
      (role.path ?? "").toLowerCase().includes(needle) ||
      (role.arn ?? "").toLowerCase().includes(needle)
    );
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredRoles.length,
  });
  const roleTableColumns: Array<DataTableColumn<IAMRole>> = [
    { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (role) => role.name },
    { id: "path", label: "Path", render: (role) => role.path ?? "-" },
    { id: "arn", label: "ARN", render: (role) => role.arn ?? "-" },
    {
      id: "policies",
      label: "Policies",
      cellClassName: "manager-table-cell-wide",
      render: (role) =>
        role.policies && role.policies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {role.policies.map((policy) => (
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
      render: (role) => (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => openEditModal(role.name)}
            className={tableActionButtonClasses}
            disabled={loadingRoleDetails && editingRole?.name === role.name}
          >
            Edit
          </button>
          <Link to={`/manager/roles/${encodeURIComponent(role.name)}/policies`} className={tableActionButtonClasses}>
            Policies
          </Link>
          <button
            onClick={() => handleDelete(role.name)}
            className={tableDeleteActionClasses}
            disabled={deletingRole === role.name}
          >
            {deletingRole === role.name ? "Deleting..." : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showAdvancedModal || showEditModal)}>
      <PageHeader
        title="IAM Roles"
        description="Manage roles using the account root keys."
        breadcrumbs={managerPageBreadcrumbs("roles")}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create role",
                  onClick: openAdvancedModal,
                },
              ]
            : []
        }
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {needsS3AccountSelection ? (
        <PageEmptyState
          title="Select an account before managing IAM roles"
          description="Roles are defined per execution context. Choose an account to list trust relationships and attached policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM roles are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage role trust policies and attached permissions."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <ListPageSection
            title="Roles"
            description="Role inventory, trust policy editing, and attached policy shortcuts."
            countLabel={`${filteredRoles.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={roleFilter}
                onChange={setRoleFilter}
                placeholder="Search by name, path, or ARN"
              />
            }
        >
          <DataTableShell
            columns={roleTableColumns}
            rows={filteredRoles}
            rowKey={(role) => role.name}
            status={filteredTableStatus}
            loadingMessage="Loading roles..."
            errorMessage="Unable to load roles."
            emptyMessage="No roles."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showAdvancedModal && (
        <WorkflowPage
          title="Create IAM role"
          description="Configure the trust policy, path and attached policies without compressing the workflow into an overlay."
          breadcrumbs={managerPageBreadcrumbs("roles", { label: "Create" })}
          backLabel="Back to roles"
          onBack={advancedCloseGuard.requestClose}
          width="standard"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
          <form className="space-y-4" onSubmit={handleAdvancedCreate}>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Role name</label>
              <input
                type="text"
                value={advancedName}
                onChange={(e) => setAdvancedName(e.target.value)}
                placeholder="Role name"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Role path (optional)</label>
              <input
                type="text"
                value={advancedPath}
                onChange={(e) => setAdvancedPath(e.target.value)}
                placeholder="/application/"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">Defaults to &quot;/&quot;. Sets the IAM path prefix for the role.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Assume role policy (JSON)</label>
              <textarea
                value={assumeRolePolicyText}
                onChange={(e) => setAssumeRolePolicyText(e.target.value)}
                className="min-h-[180px] rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                spellCheck={false}
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                IAM trust policy document used by STS AssumeRole. Provide valid JSON.
              </p>
            </div>
            <ManagedPolicySelectionPanel
              title="Attach policies"
              description="Select managed policies to grant permissions immediately."
              emptyMessage="No policies available. Create them first."
              footer="Policies can also be attached later from the role page."
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
              entityLabel="role"
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
                disabled={needsS3AccountSelection || creating}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create role"}
              </button>
            </div>
          </form>
          {advancedCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
      {showEditModal && (
        <WorkflowPage
          title={editingRole ? `Edit IAM role: ${editingRole.name}` : "Edit IAM role"}
          description="Review the immutable identity and update the role trust policy in a dedicated page."
          breadcrumbs={managerPageBreadcrumbs("roles", { label: "Edit" })}
          backLabel="Back to roles"
          onBack={editCloseGuard.requestClose}
          width="standard"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
          {loadingRoleDetails ? (
            <p className="ui-body text-slate-500 dark:text-slate-300">Loading role details...</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSaveEdit}>
              <div className="flex flex-col gap-2">
                <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Role name</label>
                <input
                  type="text"
                  value={editingRole?.name ?? ""}
                  readOnly
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-body text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Role path</label>
                <input
                  type="text"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  disabled={savingEdit}
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Path is set at creation time. IAM does not allow changing it later; updating with a different path will fail.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Assume role policy (JSON)</label>
                <textarea
                  value={editAssumeRolePolicyText}
                  onChange={(e) => setEditAssumeRolePolicyText(e.target.value)}
                  className="min-h-[200px] rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  spellCheck={false}
                  disabled={savingEdit}
                />
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  Update the trust policy document used by STS AssumeRole. Provide valid JSON.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={editCloseGuard.requestClose}
                  className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={needsS3AccountSelection || savingEdit || !editingRole}
                  className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          )}
          {editCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
