/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useS3AccountContext } from "./S3AccountContext";
import { S3AccountSelector } from "../../api/accountParams";
import { IAMGroup, attachGroupPolicy, createIamGroup, deleteIamGroup, listIamGroups } from "../../api/managerIamGroups";
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
import { uiCheckboxClass } from "../../components/ui/styles";
import InlinePolicyDraftEditor, { type InlinePolicyDraftEditorMode } from "./InlinePolicyDraftEditor";

export default function ManagerGroupsPage() {
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, selectedS3AccountId, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [groups, setGroups] = useState<IAMGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedName, setAdvancedName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [inlineDraftName, setInlineDraftName] = useState("");
  const [inlinePolicyText, setInlinePolicyText] = useState("");
  const [inlineDrafts, setInlineDrafts] = useState<InlinePolicy[]>([]);
  const [selectedInlineDraftName, setSelectedInlineDraftName] = useState<string | null>(null);
  const [inlineDraftMode, setInlineDraftMode] = useState<InlinePolicyDraftEditorMode>("create");
  const [showInlinePolicyOptions, setShowInlinePolicyOptions] = useState(false);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
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
      const data = await listIamGroups(accountId);
      setGroups(data);
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
      setGroups([]);
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
    setBusy(advancedName);
    setError(null);
    setActionMessage(null);
    try {
      const groupName = advancedName.trim();
      await createIamGroup(accountIdForApi, groupName, inlineDrafts);
      if (selectedPolicies.length > 0) {
        for (const arn of selectedPolicies) {
          const policy = policies.find((p) => p.arn === arn);
          if (policy) {
            await attachGroupPolicy(accountIdForApi, groupName, policy);
          }
        }
      }
      setAdvancedName("");
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
      setActionMessage("Group created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (needsS3AccountSelection) return;
    if (!confirmDeletion("group", name)) return;
    setBusy(name);
    setError(null);
    setActionMessage(null);
    try {
      await deleteIamGroup(accountIdForApi, name);
      setActionMessage("Group deleted");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
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

  const filteredGroups = groups.filter((group) => {
    const needle = groupFilter.trim().toLowerCase();
    if (!needle) return true;
    return group.name.toLowerCase().includes(needle) || (group.arn ?? "").toLowerCase().includes(needle);
  });
  const filteredTableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredGroups.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="IAM Groups"
        description="Manage groups using the account root keys."
        breadcrumbs={[{ label: "Manager" }, { label: "IAM" }, { label: "Groups" }]}
        actions={
          !needsS3AccountSelection && !isS3User
            ? [
                {
                  label: "Create group",
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
          title="Select an account before managing IAM groups"
          description="Groups are scoped to an execution context. Choose an account to list membership containers and attach shared policies."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : isS3User ? (
        <PageEmptyState
          title="IAM groups are unavailable for managed S3 user contexts"
          description="Switch to an RGW account or S3 connection context to manage account-level IAM groups."
          primaryAction={{ label: "Open users", to: "/manager/users" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Groups"
            description="Group inventory, membership shortcuts, and attached policies."
            countLabel={`${filteredGroups.length} result(s)`}
            search={
              <input
                type="text"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                placeholder="Search by name or ARN"
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-72 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
          />
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">ARN</th>
                <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Policies</th>
                <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredTableStatus === "loading" && <TableEmptyState colSpan={4} message="Loading groups..." />}
              {filteredTableStatus === "error" && <TableEmptyState colSpan={4} message="Unable to load groups." tone="error" />}
              {filteredTableStatus === "empty" && <TableEmptyState colSpan={4} message="No groups." />}
              {filteredGroups.map((g) => (
                  <tr key={g.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <span>{g.name}</span>
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{g.arn ?? "-"}</td>
                    <td className="manager-table-cell-wide px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {g.policies && g.policies.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {g.policies.map((p) => (
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
                          to={`/manager/groups/${encodeURIComponent(g.name)}/users`}
                          className={tableActionButtonClasses}
                        >
                          Members
                        </Link>
                        <Link
                          to={`/manager/groups/${encodeURIComponent(g.name)}/policies`}
                          className={tableActionButtonClasses}
                        >
                          Policies
                        </Link>
                        <button
                          onClick={() => handleDelete(g.name)}
                          className={tableDeleteActionClasses}
                          disabled={busy === g.name}
                        >
                          {busy === g.name ? "Deleting..." : "Delete"}
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
        <Modal title="Create IAM group" onClose={closeAdvancedModal}>
          <form className="space-y-4" onSubmit={handleAdvancedCreate}>
            <div className="flex flex-col gap-2">
              <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Group name</label>
              <input
                type="text"
                value={advancedName}
                onChange={(e) => setAdvancedName(e.target.value)}
                placeholder="Group name"
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
            </div>
            <div className="space-y-2 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Attach policies</div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Select managed policies to link immediately.</p>
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
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Policies can also be attached later from the group page.</p>
                </>
              )}
            </div>
            <InlinePolicyDraftEditor
              drafts={inlineDrafts}
              selectedDraftName={selectedInlineDraftName}
              draftName={inlineDraftName}
              draftText={inlinePolicyText}
              entityLabel="group"
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
                disabled={!selectedS3AccountId || busy !== null}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {busy === advancedName ? "Creating..." : "Create group"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
