/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useS3AccountContext } from "./S3AccountContext";
import { managerPageBreadcrumbs } from "./managerBreadcrumbs";
import { S3AccountSelector } from "../../api/accountParams";
import { IAMGroup, attachGroupPolicy, createIamGroup, deleteIamGroup, listIamGroups } from "../../api/managerIamGroups";
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

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

export default function ManagerGroupsPage() {
  const deleteConfirmation = useConfirmActionDialog();
  const { selectedS3AccountType, accountIdForApi, requiresS3AccountSelection, selectedS3AccountId, accessMode } = useS3AccountContext();
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;
  const isS3User = selectedS3AccountType === "s3_user";
  const [groups, setGroups] = useState<IAMGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
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
  const [busy, setBusy] = useState<string | null>(null);
  const [policies, setPolicies] = useState<IamPolicy[]>([]);
  const [policySearch, setPolicySearch] = useState("");
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [advancedInitialSignature, setAdvancedInitialSignature] = useState(() =>
    stableSignature({
      advancedName: "",
      selectedPolicies: [],
      inlineDrafts: [],
      inlineDraftName: "",
      inlinePolicyText: "",
    })
  );

  const load = useCallback(async (accountId: S3AccountSelector) => {
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
      setGroups([]);
      setPolicies([]);
      setLoading(false);
      return;
    }
    load(accountIdForApi);
    loadPolicies(accountIdForApi);
    resetInlinePolicyDraftEditor();
  }, [accountIdForApi, needsS3AccountSelection, accessMode, load, loadPolicies, resetInlinePolicyDraftEditor]);

  useEffect(() => {
    if (selectedPolicies.length > 0) {
      setShowPolicyOptions(true);
    }
  }, [selectedPolicies.length]);

  const advancedCurrentSignature = useMemo(
    () =>
      stableSignature({
        advancedName,
        selectedPolicies,
        inlineDrafts,
        inlineDraftName,
        inlinePolicyText,
      }),
    [advancedName, inlineDraftName, inlineDrafts, inlinePolicyText, selectedPolicies]
  );

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
      resetInlinePolicyDraftEditor();
      setShowAdvancedModal(false);
      setActionMessage("Group created");
      await load(accountIdForApi);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  };

  const deleteGroup = async (name: string) => {
    if (needsS3AccountSelection) return;
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

  const handleDelete = (name: string) => {
    if (needsS3AccountSelection) return;
    deleteConfirmation.requestConfirmation({
      title: "Delete IAM group?",
      description: "Permanently remove this IAM group from the selected account.",
      confirmLabel: "Delete group",
      details: [{ label: "IAM group", value: name }],
      impacts: ["Members will lose permissions inherited only through this group."],
      onConfirm: () => deleteGroup(name),
    });
  };

  const openAdvancedModal = () => {
    setError(null);
    setAdvancedName("");
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
    setShowAdvancedModal(true);
    setAdvancedInitialSignature(
      stableSignature({
        advancedName: "",
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
    setSelectedPolicies([]);
    setPolicySearch("");
    setShowPolicyOptions(false);
    resetInlinePolicyDraftEditor();
  };

  const advancedCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: showAdvancedModal && advancedCurrentSignature !== advancedInitialSignature,
    onClose: closeAdvancedModal,
    disabled: busy !== null,
  });

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
  const groupTableColumns: Array<DataTableColumn<IAMGroup>> = [
    { id: "name", label: "Name", primary: true, mobileRole: "primary", render: (group) => group.name },
    { id: "arn", label: "ARN", render: (group) => group.arn ?? "-" },
    {
      id: "policies",
      label: "Policies",
      cellClassName: "manager-table-cell-wide",
      render: (group) =>
        group.policies && group.policies.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {group.policies.map((policy) => (
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
      render: (group) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Link to={`/manager/groups/${encodeURIComponent(group.name)}/users`} className={tableActionButtonClasses}>
            Members
          </Link>
          <Link to={`/manager/groups/${encodeURIComponent(group.name)}/policies`} className={tableActionButtonClasses}>
            Policies
          </Link>
          <button
            onClick={() => handleDelete(group.name)}
            className={tableDeleteActionClasses}
            disabled={busy === group.name}
          >
            {busy === group.name ? "Deleting..." : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={workflowPageHostClass(showAdvancedModal)}>
      <PageHeader
        title="IAM Groups"
        description="Manage groups using the account root keys."
        breadcrumbs={managerPageBreadcrumbs("groups")}
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
        <ListPageSection
            title="Groups"
            description="Group inventory, membership shortcuts, and attached policies."
            countLabel={`${filteredGroups.length} result(s)`}
            search={
              <ManagerToolbarSearch
                value={groupFilter}
                onChange={setGroupFilter}
                placeholder="Search by name or ARN"
              />
            }
        >
          <DataTableShell
            columns={groupTableColumns}
            rows={filteredGroups}
            rowKey={(group) => group.name}
            status={filteredTableStatus}
            loadingMessage="Loading groups..."
            errorMessage="Unable to load groups."
            emptyMessage="No groups."
            responsiveCards
            tableLayout="fixed"
          />
        </ListPageSection>
      )}

      {showAdvancedModal && (
        <WorkflowPage
          title="Create IAM group"
          description="Define the group and attach its managed and inline policies in one focused workflow."
          breadcrumbs={managerPageBreadcrumbs("groups", { label: "Create" })}
          backLabel="Back to groups"
          onBack={advancedCloseGuard.requestClose}
          width="standard"
        >
          {error && <PageBanner tone="error">{error}</PageBanner>}
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
            <ManagedPolicySelectionPanel
              title="Attach policies"
              description="Select managed policies to link immediately."
              emptyMessage="No policies available. Create them first."
              footer="Policies can also be attached later from the group page."
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
                onClick={advancedCloseGuard.requestClose}
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
          {advancedCloseGuard.confirmationDialog}
        </WorkflowPage>
      )}
      {deleteConfirmation.confirmationDialog}
    </div>
  );
}
