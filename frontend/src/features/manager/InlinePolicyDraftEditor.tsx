/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { InlinePolicy } from "../../api/managerIamPolicies";
import { summarizeInlinePolicyDocument } from "./inlinePolicySummary";

export type InlinePolicyDraftEditorMode = "idle" | "create" | "edit";

type InlinePolicyDraftEditorProps = {
  drafts: InlinePolicy[];
  selectedDraftName: string | null;
  draftName: string;
  draftText: string;
  entityLabel: string;
  mode: InlinePolicyDraftEditorMode;
  expanded?: boolean;
  onCreateDraft: () => void;
  onSelectDraft: (name: string | null) => void;
  onDraftNameChange: (value: string) => void;
  onDraftTextChange: (value: string) => void;
  onSaveDraft: () => void;
  onRemoveDraft: (name: string) => void;
  onClearDrafts: () => void;
  onInsertTemplate: () => void;
  onToggleExpanded?: () => void;
};

export default function InlinePolicyDraftEditor({
  drafts,
  selectedDraftName,
  draftName,
  draftText,
  entityLabel,
  mode,
  expanded = true,
  onCreateDraft,
  onSelectDraft,
  onDraftNameChange,
  onDraftTextChange,
  onSaveDraft,
  onRemoveDraft,
  onClearDrafts,
  onInsertTemplate,
  onToggleExpanded,
}: InlinePolicyDraftEditorProps) {
  const hasDrafts = drafts.length > 0;
  const selectedDraft = selectedDraftName ? drafts.find((draft) => draft.name === selectedDraftName) ?? null : null;
  const trimmedName = draftName.trim();
  const replacementTarget = trimmedName
    ? drafts.find((draft) => draft.name === trimmedName && draft.name !== selectedDraftName) ?? null
    : null;
  const actionLabel = mode === "edit" ? "Update draft" : "Save draft";
  const showIdleState = mode === "idle" && hasDrafts;
  const showEditor = mode !== "idle" || !hasDrafts;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-200/80 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="ui-body font-semibold text-slate-800 dark:text-slate-100">Inline policies (optional)</div>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Save inline JSON policies that embed directly on this {entityLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasDrafts ? (
            <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {drafts.length} saved
            </span>
          ) : null}
          {onToggleExpanded ? (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label={expanded ? "Hide inline policies" : "Show inline policies"}
              className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
            >
              {expanded ? "Hide" : "Show"}
            </button>
          ) : null}
          {hasDrafts ? (
            <>
              <button
                type="button"
                onClick={onClearDrafts}
                className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={onCreateDraft}
                className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
              >
                Create new inline policy
              </button>
            </>
          ) : null}
        </div>
      </div>

      {expanded && hasDrafts ? (
        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white/70 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/30">
          <div className="flex items-center justify-between gap-2">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Saved inline policies
            </p>
            {showIdleState ? (
              <span className="ui-caption text-slate-500 dark:text-slate-400">Select one to edit or create a new one.</span>
            ) : null}
          </div>
          <div className="space-y-2">
            {drafts.map((draft) => {
              const isSelected = draft.name === selectedDraft?.name;

              return (
                <div
                  key={draft.name}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition ${
                    isSelected
                      ? "border-primary/50 bg-primary/10 dark:border-primary-400/50 dark:bg-primary-500/10"
                      : "border-slate-200/80 bg-white/80 dark:border-slate-700 dark:bg-slate-950/20"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDraft(draft.name)}
                    className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate ui-body font-semibold text-slate-900 dark:text-slate-100">{draft.name}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {summarizeInlinePolicyDocument(draft.document)}
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
                  <button
                    type="button"
                    onClick={() => onRemoveDraft(draft.name)}
                    className="rounded-md px-2 py-1 ui-caption font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-100"
                    aria-label={`Remove inline policy ${draft.name}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {expanded && showIdleState ? (
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
          <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
            Select a saved inline policy to edit, or create a new one.
          </p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Existing inline policies stay listed above so you can review them before adding another draft.
          </p>
        </div>
      ) : null}

      {expanded && showEditor ? (
        <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="space-y-1">
            <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
              {mode === "edit" ? `Editing "${selectedDraftName}"` : "Create a new inline policy"}
            </p>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              {mode === "edit"
                ? "Update the selected draft before creating the user, group, or role."
                : "Provide a name and valid JSON to keep this inline policy draft visible in the form."}
            </p>
          </div>

          {replacementTarget ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              Saving this draft will replace the existing draft "{replacementTarget.name}".
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="inline-draft-name-input" className="ui-body font-semibold text-slate-700 dark:text-slate-200">
                Inline policy name
              </label>
              <input
                id="inline-draft-name-input"
                type="text"
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="inline-policy"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="inline-draft-document-input" className="ui-body font-semibold text-slate-700 dark:text-slate-200">
                Inline policy document
              </label>
              <textarea
                id="inline-draft-document-input"
                value={draftText}
                onChange={(event) => onDraftTextChange(event.target.value)}
                className="min-h-[160px] w-full rounded-md border border-slate-200 px-3 py-2 ui-body font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                spellCheck={false}
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">Provide valid JSON. Blank defaults to an empty document.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onInsertTemplate}
              className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
            >
              Insert template
            </button>
            {hasDrafts ? (
              <button
                type="button"
                onClick={() => onSelectDraft(null)}
                className="rounded-full border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSaveDraft}
              className="rounded-full bg-primary px-4 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
            >
              {actionLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
