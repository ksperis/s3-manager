/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { InlinePolicy } from "../../api/managerIamPolicies";
import { confirmAction } from "../../utils/confirm";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";
import { summarizeInlinePolicyDocument } from "./inlinePolicySummary";

type InlinePolicyEditorProps = {
  entityLabel: string;
  entityName: string;
  loadPolicies: () => Promise<InlinePolicy[]>;
  savePolicy: (name: string, document: Record<string, unknown>) => Promise<void>;
  deletePolicy: (name: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
};

type EditorMode = "idle" | "create" | "edit";

export default function InlinePolicyEditor({
  entityLabel,
  entityName,
  loadPolicies,
  savePolicy,
  deletePolicy,
  disabled = false,
  disabledReason,
}: InlinePolicyEditorProps) {
  const [policies, setPolicies] = useState<InlinePolicy[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [policyText, setPolicyText] = useState("");
  const [activePolicyName, setActivePolicyName] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("idle");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const trimmedName = selectedName.trim();
  const hasPolicies = policies.length > 0;
  const selectedPolicy = activePolicyName ? policies.find((policy) => policy.name === activePolicyName) ?? null : null;
  const replacementTarget = trimmedName
    ? policies.find((policy) => policy.name === trimmedName && policy.name !== activePolicyName) ?? null
    : null;
  const createsNewFromExisting = Boolean(activePolicyName && trimmedName && trimmedName !== activePolicyName && !replacementTarget);
  const canDelete = editorMode === "edit" && Boolean(selectedPolicy);
  const showPromptState = editorMode === "idle";
  const actionLabel = useMemo(() => {
    if (activePolicyName && trimmedName === activePolicyName) {
      return "Update existing inline policy";
    }
    if (replacementTarget) {
      return "Replace existing inline policy";
    }
    return "Save new inline policy";
  }, [activePolicyName, replacementTarget, trimmedName]);

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

  const formatPolicyText = (policy?: InlinePolicy) => {
    if (!policy) return "";
    try {
      return JSON.stringify(policy.document ?? {}, null, 2);
    } catch {
      return "";
    }
  };

  const refresh = useCallback(async (nextActiveName: string | null) => {
    if (disabled || !entityName) {
      setPolicies([]);
      setActivePolicyName(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadPolicies();
      setPolicies(data);

      if (!nextActiveName) {
        return;
      }

      const current = data.find((policy) => policy.name === nextActiveName);
      if (current) {
        setActivePolicyName(current.name);
        setSelectedName(current.name);
        setPolicyText(formatPolicyText(current));
        setEditorMode("edit");
        return;
      }

      setActivePolicyName(null);
      setSelectedName("");
      setPolicyText("");
      setEditorMode("idle");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [disabled, entityName, loadPolicies]);

  useEffect(() => {
    setSelectedName("");
    setPolicyText("");
    setActivePolicyName(null);
    setEditorMode("idle");
    setMessage(null);
    setError(null);
    void refresh(null);
  }, [entityName, disabled, refresh]);

  const handleSelectExisting = (name: string) => {
    const existing = policies.find((policy) => policy.name === name);
    if (!existing) return;
    setActivePolicyName(existing.name);
    setSelectedName(existing.name);
    setPolicyText(formatPolicyText(existing));
    setEditorMode("edit");
    setMessage(null);
    setError(null);
  };

  const handleStartCreate = () => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("create");
    setMessage(null);
    setError(null);
  };

  const handleCancel = () => {
    setActivePolicyName(null);
    setSelectedName("");
    setPolicyText("");
    setEditorMode("idle");
    setMessage(null);
    setError(null);
  };

  const handleInsertTemplate = () => {
    setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
    setMessage(null);
    setError(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (!trimmedName) {
      setError("Inline policy name is required.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = policyText.trim() ? JSON.parse(policyText) : {};
    } catch {
      setError("Inline policy must be valid JSON.");
      return;
    }

    const isUpdatingSelected = Boolean(activePolicyName && trimmedName === activePolicyName);
    const isReplacingExisting = Boolean(replacementTarget);
    const isCreatingFromExisting = Boolean(activePolicyName && trimmedName !== activePolicyName && !replacementTarget);

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await savePolicy(trimmedName, parsed);
      await refresh(trimmedName);
      if (isUpdatingSelected) {
        setMessage("Inline policy updated.");
      } else if (isReplacingExisting) {
        setMessage(`Inline policy "${trimmedName}" replaced.`);
      } else if (isCreatingFromExisting) {
        setMessage(`New inline policy "${trimmedName}" created. "${activePolicyName}" remains unchanged.`);
      } else {
        setMessage("Inline policy saved.");
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (disabled || !selectedPolicy) return;
    if (!confirmAction(`Delete inline policy "${selectedPolicy.name}" from this ${entityLabel}?`)) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await deletePolicy(selectedPolicy.name);
      await refresh(null);
      setActivePolicyName(null);
      setSelectedName("");
      setPolicyText("");
      setEditorMode("idle");
      setMessage("Inline policy deleted.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="ui-surface-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Inline policies</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {selectedPolicy
              ? `Editing "${selectedPolicy.name}".`
              : hasPolicies
                ? "Select an existing inline policy to review or edit."
                : "No inline policies created yet."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </span>
          {hasPolicies ? (
            <button
              type="button"
              onClick={handleStartCreate}
              disabled={disabled}
              className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100"
            >
              Create new inline policy
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refresh(activePolicyName)}
            disabled={disabled || loading}
            className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {disabled ? (
          <UiInlineMessage tone="warning">
            {disabledReason ?? "Select an account before editing inline policies."}
          </UiInlineMessage>
        ) : null}
        {error ? (
          <UiInlineMessage tone="error">{error}</UiInlineMessage>
        ) : null}
        {message ? (
          <UiInlineMessage tone="success">{message}</UiInlineMessage>
        ) : null}

        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/30">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Existing inline policies
            </span>
            {loading ? <span className="ui-caption text-slate-500 dark:text-slate-400">Loading inline policies...</span> : null}
          </div>
          {!loading && !hasPolicies ? (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No inline policy exists yet.</p>
          ) : null}
          <div className="space-y-2">
            {policies.map((policy) => {
              const isSelected = policy.name === selectedPolicy?.name;

              return (
                <button
                  key={policy.name}
                  type="button"
                  onClick={() => handleSelectExisting(policy.name)}
                  disabled={disabled}
                  className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
                    isSelected
                      ? "border-primary/50 bg-primary/10 dark:border-primary-400/50 dark:bg-primary-500/10"
                      : "border-slate-200/80 bg-white/80 hover:border-primary/40 dark:border-slate-700 dark:bg-slate-950/20 dark:hover:border-primary-500/40"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate ui-body font-semibold text-slate-900 dark:text-slate-100">{policy.name}</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      {summarizeInlinePolicyDocument(policy.document)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 ui-caption font-semibold ${
                      isSelected
                        ? "bg-primary/15 text-primary dark:bg-primary-500/20 dark:text-primary-100"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {isSelected ? "Selected" : "Edit"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {showPromptState ? (
          <div className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                  {hasPolicies ? "Select an existing inline policy to review or edit" : "Create the first inline policy"}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {hasPolicies
                    ? "Existing inline policies stay visible above so you can avoid creating a second policy by mistake."
                    : `Add an inline JSON policy that will live directly on this ${entityLabel}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleStartCreate}
                disabled={disabled}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {hasPolicies ? "Create new inline policy" : "Create inline policy"}
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSave}>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                {selectedPolicy ? `Edit "${selectedPolicy.name}"` : "Create a new inline policy"}
              </p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {selectedPolicy
                  ? "Update the selected inline policy or change its name to save a different one."
                  : `Provide a name and valid JSON to create a new inline policy on this ${entityLabel}.`}
              </p>
            </div>

            {replacementTarget ? (
              <UiInlineMessage tone="warning">
                Saving with the name "{replacementTarget.name}" will replace that existing inline policy. The currently selected
                policy will remain unchanged.
              </UiInlineMessage>
            ) : createsNewFromExisting ? (
              <UiInlineMessage tone="info">
                Changing the name from "{activePolicyName}" will create a new inline policy instead of editing the selected one.
              </UiInlineMessage>
            ) : null}

            <div className="flex flex-col gap-2">
              <label htmlFor="inline-policy-name-input" className="ui-body font-semibold text-slate-700 dark:text-slate-200">
                Inline policy name
              </label>
              <input
                id="inline-policy-name-input"
                type="text"
                value={selectedName}
                onChange={(event) => setSelectedName(event.target.value)}
                className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="inline-policy"
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="inline-policy-document-input" className="ui-body font-semibold text-slate-700 dark:text-slate-200">
                Inline policy document (JSON)
              </label>
              <textarea
                id="inline-policy-document-input"
                value={policyText}
                onChange={(event) => setPolicyText(event.target.value)}
                className="min-h-[220px] rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                spellCheck={false}
                disabled={disabled}
                placeholder={`{
  "Version": "2012-10-17",
  "Statement": []
}`}
              />
              <div className="flex flex-wrap items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={handleInsertTemplate}
                  className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  disabled={disabled}
                >
                  Insert template
                </button>
                <span>Blank JSON will save as an empty document.</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={disabled || deleting}
                    className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
                  >
                    {deleting ? "Deleting..." : "Delete inline policy"}
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={disabled}
                  className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disabled || saving}
                  className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                >
                  {saving ? "Saving..." : actionLabel}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
