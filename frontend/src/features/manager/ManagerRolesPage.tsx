/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useS3AccountContext } from "./S3AccountContext";
import { S3AccountSelector } from "../../api/accountParams";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  IAMRole,
  attachRolePolicy,
  createIamRole,
  deleteIamRole,
  getIamRole,
  listIamRoles,
  updateIamRole,
} from "../../api/managerIamRoles";
import { IamPolicy, InlinePolicy, listIamPolicies } from "../../api/managerIamPolicies";
import ListToolbar from "../../components/ListToolbar";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import Modal from "../../components/Modal";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmDeletion } from "../../utils/confirm";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import InlinePolicyDraftEditor, { type InlinePolicyDraftEditorMode } from "./InlinePolicyDraftEditor";

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

export default function ManagerRolesPage() {
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [roles, setRoles] = useState<IAMRole[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedName, setAdvancedName] = useState("");
  const [advancedPath, setAdvancedPath] = useState(DEFAULT_ROLE_PATH);
  const [assumeRolePolicyText, setAssumeRolePolicyText] = useState(DEFAULT_ASSUME_ROLE_DOCUMENT);
  const [creating, setCreating] = useState(false);
  const [deletingRole, setDeletingRole] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [inlineDraftName, setInlineDraftName] = useState("");
  const [inlinePolicyText, setInlinePolicyText] = useState("");
  const [inlineDrafts, setInlineDrafts] = useState<InlinePolicy[]>([]);
  const [selectedInlineDraftName, setSelectedInlineDraftName] = useState<string | null>(null);
  const [inlineDraftMode, setInlineDraftMode] = useState<InlinePolicyDraftEditorMode>("create");
  const [showInlinePolicyOptions, setShowInlinePolicyOptions] = useState(false);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRole, setEditingRole] = useState<IAMRole | null>(null);
  const [editPath, setEditPath] = useState(DEFAULT_ROLE_PATH);
  const [editAssumeRolePolicyText, setEditAssumeRolePolicyText] = useState(DEFAULT_ASSUME_ROLE_DOCUMENT);
  const [loadingRoleDetails, setLoadingRoleDetails] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
      const data = await listIamRoles(accountId);
      setRoles(data);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
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
      setRoles([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadPolicies(accountIdForApi);
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
  }, [accountIdForApi, needsS3AccountSelection, accessMode]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const filteredPolicies = useMemo(() => {
    const query = policySearch.trim().toLowerCase();
    if (!query) return policies;
    return policies.filter((policy) => {
      const name = policy.name.toLowerCase();
      const arn = policy.arn.toLowerCase();
      return name.includes(query) || arn.includes(query);
    });
  }, [policies, policySearch]);

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
      setInlineDrafts([]);
      setSelectedInlineDraftName(null);
      setInlineDraftName("");
      setInlinePolicyText("");
      setInlineDraftMode("create");
      setShowInlinePolicyOptions(false);
      setShowAdvancedModal(false);
      setActionMessage("Role created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (needsS3AccountSelection) return;
    if (!confirmDeletion("role", name)) return;
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

  const openAdvancedModal = () => {
    setShowAdvancedModal(true);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode(inlineDrafts.length > 0 ? "idle" : "create");
    setShowInlinePolicyOptions(false);
  };

  const closeAdvancedModal = () => {
    setShowAdvancedModal(false);
    setAdvancedPath(DEFAULT_ROLE_PATH);
    setAssumeRolePolicyText(DEFAULT_ASSUME_ROLE_DOCUMENT);
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    setInlineDrafts([]);
    setSelectedInlineDraftName(null);
    setInlineDraftName("");
    setInlinePolicyText("");
    setInlineDraftMode("create");
    setShowInlinePolicyOptions(false);
  };

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
      setEditingRole(role);
      setEditPath(role.path ?? DEFAULT_ROLE_PATH);
      setEditAssumeRolePolicyText(formatAssumePolicyText(role.assume_role_policy_document));
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
  };

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="IAM Roles"
        description="Manage roles using the account root keys."
        breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Roles" }]}
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
        <div className="ui-surface-card">
          <ListToolbar
            title="Roles"
            description="Role inventory, trust policy editing, and attached policy shortcuts."
            countLabel={`${filteredRoles.length} result(s)`}
            search={
              <input
                type="text"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                placeholder="Search by name, path, or ARN"
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
          />
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Path</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">ARN</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Policies</th>
                <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredTableStatus === "loading" && <TableEmptyState colSpan={5} message="Loading roles..." />}
              {filteredTableStatus === "error" && <TableEmptyState colSpan={5} message="Unable to load roles." tone="error" />}
              {filteredTableStatus === "empty" && <TableEmptyState colSpan={5} message="No roles." />}
              {filteredRoles.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <span>{r.name}</span>
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{r.path ?? "-"}</td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{r.arn ?? "-"}</td>
                    <td className="manager-table-cell-wide px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {r.policies && r.policies.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {r.policies.map((p) => (
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
                        <button
                          onClick={() => openEditModal(r.name)}
                          className={tableActionButtonClasses}
                          disabled={loadingRoleDetails && editingRole?.name === r.name}
                        >
                          Edit
                        </button>
                        <Link
                          to={`/manager/roles/${encodeURIComponent(r.name)}/policies`}
                          className={tableActionButtonClasses}
                        >
                          Policies
                        </Link>
                        <button
                          onClick={() => handleDelete(r.name)}
                          className={tableDeleteActionClasses}
                          disabled={deletingRole === r.name}
                        >
                          {deletingRole === r.name ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdvancedModal && (
        <Modal title="Create IAM role" onClose={closeAdvancedModal}>
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
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Attach policies</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Select managed policies to grant permissions immediately.</p>
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
                    <p className="ui-caption text-slate-500 dark:text-slate-400">No policies available. Create them first.</p>
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
                                className={uiCheckboxClass}
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
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Policies can also be attached later from the role page.</p>
                </>
              )}
            </div>
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
                onClick={closeAdvancedModal}
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
        </Modal>
      )}
      {showEditModal && (
        <Modal title={editingRole ? `Edit IAM role: ${editingRole.name}` : "Edit IAM role"} onClose={closeEditModal}>
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
                  onClick={closeEditModal}
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
        </Modal>
      )}
    </div>
  );
}
