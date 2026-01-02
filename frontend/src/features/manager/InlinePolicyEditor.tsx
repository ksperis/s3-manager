/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { InlinePolicy } from "../../api/managerIamPolicies";
import { confirmAction } from "../../utils/confirm";
import { DEFAULT_INLINE_POLICY_TEXT } from "./inlinePolicyTemplate";

type InlinePolicyEditorProps = {
  entityLabel: string;
  entityName: string;
  loadPolicies: () => Promise<InlinePolicy[]>;
  savePolicy: (name: string, document: Record<string, unknown>) => Promise<void>;
  deletePolicy: (name: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
};

const DEFAULT_POLICY_NAME = "inline-policy";

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
  const [selectedName, setSelectedName] = useState(DEFAULT_POLICY_NAME);
  const [policyText, setPolicyText] = useState(DEFAULT_INLINE_POLICY_TEXT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const hasExisting = useMemo(() => policies.some((p) => p.name === selectedName), [policies, selectedName]);

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
    if (!policy) return DEFAULT_INLINE_POLICY_TEXT;
    try {
      return JSON.stringify(policy.document ?? {}, null, 2);
    } catch {
      return DEFAULT_INLINE_POLICY_TEXT;
    }
  };

  const refresh = async () => {
    if (disabled || !entityName) {
      setPolicies([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadPolicies();
      setPolicies(data);
      if (data.length > 0 && data.some((p) => p.name === selectedName)) {
        const current = data.find((p) => p.name === selectedName);
        setPolicyText(formatPolicyText(current));
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedName(DEFAULT_POLICY_NAME);
    setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
    setMessage(null);
    setError(null);
    refresh();
  }, [entityName, disabled]);

  const handleSelectExisting = (name: string) => {
    setSelectedName(name);
    const existing = policies.find((p) => p.name === name);
    setPolicyText(formatPolicyText(existing));
    setMessage(null);
    setError(null);
  };

  const handleReset = () => {
    setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
    setMessage(null);
    setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const trimmedName = selectedName.trim();
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
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await savePolicy(trimmedName, parsed);
      await refresh();
      setSelectedName(trimmedName);
      setMessage("Inline policy saved.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (disabled || !hasExisting) return;
    if (!confirmAction(`Delete inline policy "${selectedName}" from this ${entityLabel}?`)) return;
    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await deletePolicy(selectedName);
      await refresh();
      setSelectedName(DEFAULT_POLICY_NAME);
      setPolicyText(DEFAULT_INLINE_POLICY_TEXT);
      setMessage("Inline policy deleted.");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Inline policies</p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Create or update inline policies directly on this {entityLabel}.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={disabled || loading}
          className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-100"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <form className="space-y-4 p-4" onSubmit={handleSave}>
        {disabled && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            {disabledReason ?? "Select an account before editing inline policies."}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-caption text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-100">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-caption text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
            {message}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Existing</span>
            {loading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading inline policies...</span>}
            {!loading && policies.length === 0 && (
              <span className="ui-caption text-slate-500 dark:text-slate-400">None yet</span>
            )}
            {policies.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleSelectExisting(p.name)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ui-caption font-semibold transition ${
                  p.name === selectedName
                    ? "border-primary bg-primary/10 text-primary dark:border-primary-400 dark:text-primary-100"
                    : "border-slate-200 text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                }`}
                disabled={disabled}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Inline policy name</label>
            <input
              type="text"
              value={selectedName}
              onChange={(e) => setSelectedName(e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="ui-body font-semibold text-slate-700 dark:text-slate-200">Inline policy document (JSON)</label>
            <textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              className="min-h-[220px] rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              spellCheck={false}
              disabled={disabled}
            />
            <div className="flex flex-wrap items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                disabled={disabled}
              >
                Reset template
              </button>
              <span>Provide valid JSON. Saving will upsert the inline policy on the {entityLabel}.</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {hasExisting && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={disabled || deleting}
              className="rounded-md border border-rose-200 px-4 py-2 ui-body font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
            >
              {deleting ? "Deleting..." : "Delete inline policy"}
            </button>
          )}
          <button
            type="submit"
            disabled={disabled || saving}
            className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save inline policy"}
          </button>
        </div>
      </form>
    </div>
  );
}
