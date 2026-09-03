/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import {
  type CephAdminBucket,
  listCephAdminUsers,
  type CephAdminRgwUser,
} from "../../api/cephAdmin";
import {
  listCephAdminAccounts,
  type CephAdminRgwAccount,
} from "../../api/cephAdminAccounts";
import {
  checkCephAdminBucketIndex,
  type CephAdminAdminOpsResult,
  deleteCephAdminAccount,
  deleteCephAdminBucket,
  deleteCephAdminUser,
  linkCephAdminBucket,
  unlinkCephAdminBucket,
} from "../../api/cephAdminAdminOps";
import Modal from "../../components/Modal";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiDetails from "../../components/ui/UiDetails";
import UiSegmentedControl from "../../components/ui/UiSegmentedControl";
import { uiInputClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";

type AccountAction = {
  kind: "delete-account";
  account: CephAdminRgwAccount;
};

type UserAction = {
  kind: "delete-user";
  user: CephAdminRgwUser;
};

export type BucketAdminOpsKind = "delete-bucket" | "unlink-bucket" | "link-bucket" | "index-check";

type BucketAction = {
  kind: BucketAdminOpsKind;
  bucket: CephAdminBucket;
};

export type CephAdminAdminOpsAction = AccountAction | UserAction | BucketAction;

type LinkTarget = {
  type: "user" | "account";
  id: string;
  label: string;
};

type Props = {
  endpointId: number;
  endpointName?: string | null;
  action: CephAdminAdminOpsAction;
  canAccounts?: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function userId(user: CephAdminRgwUser): string {
  return user.tenant ? `${user.tenant}$${user.uid}` : user.uid;
}

function bucketId(bucket: CephAdminBucket): string {
  return bucket.tenant ? `${bucket.tenant}/${bucket.name}` : bucket.name;
}

function structuredResultFromError(error: unknown): CephAdminAdminOpsResult | null {
  const responseData = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!responseData || typeof responseData !== "object") return null;
  const candidate = responseData as Partial<CephAdminAdminOpsResult>;
  if (typeof candidate.operation !== "string" || typeof candidate.success !== "boolean") return null;
  return {
    operation: candidate.operation,
    success: candidate.success,
    rgw_status_code: candidate.rgw_status_code ?? null,
    rgw_error_code: candidate.rgw_error_code ?? null,
    message: typeof candidate.message === "string" ? candidate.message : "RGW Admin Ops operation failed.",
    result: candidate.result,
  };
}

function formattedResult(value: unknown): string {
  if (value == null || value === "") return "No response body.";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CephAdminAdminOpsModal({
  endpointId,
  endpointName,
  action,
  canAccounts = true,
  onClose,
  onSuccess,
}: Props) {
  const [purgeData, setPurgeData] = useState(false);
  const [purgeObjects, setPurgeObjects] = useState(false);
  const [bypassGc, setBypassGc] = useState(false);
  const [fixIndex, setFixIndex] = useState(false);
  const [checkObjects, setCheckObjects] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [linkTargetType, setLinkTargetType] = useState<"user" | "account">("user");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [selectedLinkTarget, setSelectedLinkTarget] = useState<LinkTarget | null>(null);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CephAdminAdminOpsResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const target = useMemo(() => {
    if (action.kind === "delete-account") return action.account.account_id;
    if (action.kind === "delete-user") return userId(action.user);
    return bucketId(action.bucket);
  }, [action]);

  const expectedPhrase = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return `DELETE ACCOUNT ${target}`;
      case "delete-user":
        return `${purgeData ? "PURGE" : "DELETE"} USER ${target}`;
      case "delete-bucket":
        return `${purgeObjects ? "PURGE AND DELETE" : "DELETE"} BUCKET ${target}`;
      case "unlink-bucket":
        return `UNLINK BUCKET ${target}`;
      case "link-bucket":
        return selectedLinkTarget ? `LINK BUCKET ${target} TO ${selectedLinkTarget.id}` : "";
      case "index-check":
        return fixIndex ? `FIX BUCKET INDEX ${target}` : "";
    }
  }, [action.kind, fixIndex, purgeData, purgeObjects, selectedLinkTarget, target]);

  const requiresPhrase = action.kind !== "index-check" || fixIndex;
  const title = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return "Delete RGW Account";
      case "delete-user":
        return "Delete RGW User";
      case "delete-bucket":
        return "RGW Admin Ops · Delete bucket";
      case "unlink-bucket":
        return "RGW Admin Ops · Unlink bucket";
      case "link-bucket":
        return "RGW Admin Ops · Link bucket";
      case "index-check":
        return "RGW Admin Ops · Check bucket index";
    }
  }, [action.kind]);

  const impact = useMemo(() => {
    switch (action.kind) {
      case "delete-account":
        return "The account is removed only when RGW considers it empty. Users and buckets must be removed first.";
      case "delete-user":
        return purgeData
          ? "RGW removes the user and purges data owned by it. This cannot be undone."
          : "RGW removes the user only when no owned data prevents deletion.";
      case "delete-bucket":
        return purgeObjects
          ? "RGW permanently removes the bucket and all of its objects and versions."
          : "RGW removes the bucket only when it is empty.";
      case "unlink-bucket":
        return "RGW removes the current owner association. The bucket data remains in place.";
      case "link-bucket":
        return "RGW changes the bucket association. This is not a chown and object ACLs are not rewritten.";
      case "index-check":
        return fixIndex
          ? "RGW checks the bucket index and applies repairs."
          : "RGW inspects the bucket index without applying changes.";
    }
  }, [action.kind, fixIndex, purgeData, purgeObjects]);

  useEffect(() => {
    if (action.kind !== "link-bucket") return;
    if (linkTargetType === "account" && !canAccounts) {
      setLinkTargetType("user");
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setTargetsLoading(true);
      setTargetsError(null);
      const load = async () => {
        try {
          if (linkTargetType === "account") {
            const response = await listCephAdminAccounts(endpointId, {
              page: 1,
              page_size: 25,
              search: linkSearch.trim() || undefined,
              sort_by: "account_id",
              sort_dir: "asc",
            });
            if (!active) return;
            setLinkTargets(
              response.items.map((account) => ({
                type: "account",
                id: account.account_id,
                label: account.account_name ? `${account.account_name} · ${account.account_id}` : account.account_id,
              }))
            );
          } else {
            const response = await listCephAdminUsers(endpointId, {
              page: 1,
              page_size: 25,
              search: linkSearch.trim() || undefined,
              sort_by: "uid",
              sort_dir: "asc",
            });
            if (!active) return;
            setLinkTargets(
              response.items.map((user) => ({
                type: "user",
                id: userId(user),
                label: user.full_name ? `${user.full_name} · ${userId(user)}` : userId(user),
              }))
            );
          }
        } catch (error) {
          if (!active) return;
          setLinkTargets([]);
          setTargetsError(extractApiError(error, "Unable to load RGW link targets."));
        } finally {
          if (active) setTargetsLoading(false);
        }
      };
      void load();
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [action.kind, canAccounts, endpointId, linkSearch, linkTargetType]);

  const resetOutcome = () => {
    setResult(null);
    setRequestError(null);
    setConfirmation("");
  };

  const run = async () => {
    setSubmitting(true);
    setRequestError(null);
    setResult(null);
    try {
      let response: CephAdminAdminOpsResult;
      switch (action.kind) {
        case "delete-account":
          response = await deleteCephAdminAccount(endpointId, action.account.account_id, confirmation);
          break;
        case "delete-user":
          response = await deleteCephAdminUser(
            endpointId,
            action.user.uid,
            { confirmation, purge_data: purgeData },
            action.user.tenant
          );
          break;
        case "delete-bucket":
          response = await deleteCephAdminBucket(
            endpointId,
            action.bucket.name,
            { confirmation, purge_objects: purgeObjects, bypass_gc: bypassGc },
            action.bucket.tenant
          );
          break;
        case "unlink-bucket":
          response = await unlinkCephAdminBucket(endpointId, action.bucket.name, confirmation, action.bucket.tenant);
          break;
        case "link-bucket":
          if (!selectedLinkTarget) return;
          response = await linkCephAdminBucket(
            endpointId,
            action.bucket.name,
            {
              confirmation,
              target_type: selectedLinkTarget.type,
              target_id: selectedLinkTarget.id,
            },
            action.bucket.tenant
          );
          break;
        case "index-check":
          response = await checkCephAdminBucketIndex(
            endpointId,
            action.bucket.name,
            { confirmation: confirmation || undefined, fix: fixIndex, check_objects: checkObjects },
            action.bucket.tenant
          );
          break;
      }
      setResult(response);
      if (response.success) onSuccess();
    } catch (error) {
      const structured = structuredResultFromError(error);
      if (structured) {
        setResult(structured);
      } else {
        setRequestError(extractApiError(error, "RGW Admin Ops operation failed."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const linkTargetRequired = action.kind === "link-bucket" && !selectedLinkTarget;
  const confirmationMatches = !requiresPhrase || confirmation === expectedPhrase;
  const submitDisabled = submitting || Boolean(result?.success) || linkTargetRequired || !confirmationMatches;

  return (
    <Modal
      title={title}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      maxBodyHeightClass="max-h-[82vh]"
      closeOnBackdropClick={!submitting}
      closeOnEscape={!submitting}
    >
      <div className="space-y-5">
        <dl className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-900/60 sm:grid-cols-2">
          <div>
            <dt className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">Target</dt>
            <dd className="mt-1 break-all font-mono text-slate-900 dark:text-slate-100">{target}</dd>
          </div>
          <div>
            <dt className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">Endpoint</dt>
            <dd className="mt-1 text-slate-900 dark:text-slate-100">{endpointName || `#${endpointId}`}</dd>
          </div>
        </dl>

        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold">Impact</p>
          <p className="mt-1">{impact}</p>
        </div>

        {action.kind === "delete-user" && (
          <UiCheckboxField
            checked={purgeData}
            onChange={(event) => {
              setPurgeData(event.target.checked);
              resetOutcome();
            }}
            className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200"
          >
            <span>
              <span className="block font-semibold">Purge owned data</span>
              <span className="block text-slate-500 dark:text-slate-400">Passes purge-data to RGW. Disabled by default.</span>
            </span>
          </UiCheckboxField>
        )}

        {action.kind === "delete-bucket" && (
          <div className="space-y-3">
            <UiCheckboxField
              checked={purgeObjects}
              onChange={(event) => {
                const checked = event.target.checked;
                setPurgeObjects(checked);
                if (!checked) setBypassGc(false);
                resetOutcome();
              }}
              className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200"
            >
              <span>
                <span className="block font-semibold">Purge objects and versions</span>
                <span className="block text-slate-500 dark:text-slate-400">Passes purge-objects to RGW. Disabled by default.</span>
              </span>
            </UiCheckboxField>
            <UiDetails className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                Advanced options
              </summary>
              <div className="pt-3">
                <UiCheckboxField
                  checked={bypassGc}
                  disabled={!purgeObjects}
                  onChange={(event) => {
                    setBypassGc(event.target.checked);
                    resetOutcome();
                  }}
                  className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200"
                >
                  <span>
                    <span className="block font-semibold">Bypass garbage collection</span>
                    <span className="block text-rose-700 dark:text-rose-300">
                      Exceptional recovery option. Ceph strongly recommends normal garbage collection.
                    </span>
                  </span>
                </UiCheckboxField>
              </div>
            </UiDetails>
          </div>
        )}

        {action.kind === "index-check" && (
          <div className="space-y-3">
            <UiCheckboxField
              checked={fixIndex}
              onChange={(event) => {
                const checked = event.target.checked;
                setFixIndex(checked);
                if (!checked) setCheckObjects(false);
                resetOutcome();
              }}
              className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200"
            >
              <span>
                <span className="block font-semibold">Fix detected index issues</span>
                <span className="block text-slate-500 dark:text-slate-400">Turns this check into a modifying operation.</span>
              </span>
            </UiCheckboxField>
            <UiCheckboxField
              checked={checkObjects}
              disabled={!fixIndex}
              onChange={(event) => {
                setCheckObjects(event.target.checked);
                resetOutcome();
              }}
              className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200"
            >
              <span>
                <span className="block font-semibold">Check object state</span>
                <span className="block text-slate-500 dark:text-slate-400">Ceph requires fix to be enabled first.</span>
              </span>
            </UiCheckboxField>
          </div>
        )}

        {action.kind === "link-bucket" && (
          <div className="space-y-3">
            <UiSegmentedControl
              ariaLabel="RGW link target type"
              value={linkTargetType}
              options={[
                { label: "RGW Users", value: "user" },
                {
                  label: "RGW Accounts",
                  value: "account",
                  disabled: !canAccounts,
                  title: canAccounts ? undefined : "RGW Accounts require Ceph Squid or later.",
                },
              ]}
              onChange={(value) => {
                setLinkTargetType(value);
                setSelectedLinkTarget(null);
                setLinkSearch("");
                resetOutcome();
              }}
            />
            <label className="block space-y-1">
              <span className="ui-caption font-semibold uppercase text-slate-500 dark:text-slate-400">Search targets</span>
              <input
                value={linkSearch}
                onChange={(event) => {
                  setLinkSearch(event.target.value);
                  setSelectedLinkTarget(null);
                  resetOutcome();
                }}
                className={uiInputClass}
                placeholder={linkTargetType === "user" ? "Search RGW Users" : "Search RGW Accounts"}
              />
            </label>
            <div className="max-h-44 overflow-y-auto rounded-md border border-slate-200 p-1 dark:border-slate-700">
              {targetsLoading ? (
                <p className="p-3 text-sm text-slate-500 dark:text-slate-400">Loading targets...</p>
              ) : targetsError ? (
                <p className="p-3 text-sm text-rose-700 dark:text-rose-300">{targetsError}</p>
              ) : linkTargets.length === 0 ? (
                <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No matching target.</p>
              ) : (
                linkTargets.map((candidate) => (
                  <button
                    key={`${candidate.type}:${candidate.id}`}
                    type="button"
                    aria-pressed={selectedLinkTarget?.id === candidate.id}
                    className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
                      selectedLinkTarget?.id === candidate.id
                        ? "bg-primary text-white"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                    onClick={() => {
                      setSelectedLinkTarget(candidate);
                      resetOutcome();
                    }}
                  >
                    {candidate.label}
                  </button>
                ))
              )}
            </div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Link is not a chown operation and does not rewrite object ACLs.
            </p>
          </div>
        )}

        {requiresPhrase ? (
          <label className="block space-y-2">
            <span className="text-sm text-slate-700 dark:text-slate-200">
              Type <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{expectedPhrase || "Select a target"}</code>
            </span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className={uiInputClass}
              disabled={!expectedPhrase || submitting || Boolean(result?.success)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Confirmation phrase"
            />
          </label>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This read-only check requires a simple confirmation with the button below.
          </p>
        )}

        {requestError && (
          <div role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200">
            {requestError}
          </div>
        )}

        {result && (
          <section
            aria-label="RGW Admin Ops result"
            className={`space-y-3 rounded-md border p-4 ${
              result.success
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
                : "border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30"
            }`}
          >
            <div className="flex flex-wrap gap-2 text-sm font-semibold">
              <span>{result.success ? "Completed" : "Failed"}</span>
              <span>RGW HTTP {result.rgw_status_code ?? "unavailable"}</span>
              {result.rgw_error_code && <span>Ceph code {result.rgw_error_code}</span>}
            </div>
            <p className="text-sm">{result.message}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-xs text-slate-100">
              {formattedResult(result.result)}
            </pre>
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <UiButton variant="secondary" onClick={onClose} disabled={submitting}>
            Close
          </UiButton>
          <UiButton variant={action.kind === "index-check" && !fixIndex ? "primary" : "danger"} onClick={() => void run()} disabled={submitDisabled}>
            {submitting ? "Running..." : result?.success ? "Completed" : result ? "Retry" : action.kind === "index-check" && !fixIndex ? "Run check" : "Run operation"}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
