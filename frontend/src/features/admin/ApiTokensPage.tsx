/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiTokenInfo,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../../api/apiTokens";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";

type TokenStatus = "active" | "expired" | "revoked";

type RevealedToken = {
  value: string;
  token: ApiTokenInfo;
};

const DEFAULT_EXPIRY_DAYS = 90;

function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) return detail;
    return error.message || "Unable to complete request.";
  }
  if (error instanceof Error) return error.message;
  return "Unable to complete request.";
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function resolveTokenStatus(token: ApiTokenInfo): TokenStatus {
  if (token.revoked_at) return "revoked";
  const expiry = new Date(token.expires_at);
  if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now()) return "expired";
  return "active";
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function StatusBadge({ status }: { status: TokenStatus }) {
  const classes =
    status === "active"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
      : status === "expired"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100";
  return (
    <span className={`inline-flex rounded-full px-2 py-1 ui-caption font-semibold uppercase tracking-wide ${classes}`}>
      {status}
    </span>
  );
}

export default function ApiTokensPage() {
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [busyTokenId, setBusyTokenId] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<RevealedToken | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const apiBase = useMemo(() => {
    const configured = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");
    if (configured.startsWith("http://") || configured.startsWith("https://")) {
      return configured;
    }
    return `http://localhost:8000${configured}`;
  }, []);

  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const left = new Date(a.created_at).getTime();
      const right = new Date(b.created_at).getTime();
      if (Number.isNaN(left) || Number.isNaN(right)) return 0;
      return right - left;
    });
  }, [tokens]);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiTokens(includeRevoked);
      setTokens(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError(extractError(loadError));
    } finally {
      setLoading(false);
    }
  }, [includeRevoked]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const resetCreateForm = () => {
    setTokenName("");
    setExpiresInDays(String(DEFAULT_EXPIRY_DAYS));
    setFormError(null);
    setCreating(false);
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setFormError(null);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setActionMessage(null);
    const normalizedName = tokenName.trim();
    if (!normalizedName) {
      setFormError("Token name is required.");
      return;
    }
    const normalizedDays = expiresInDays.trim();
    let payloadDays: number | undefined;
    if (normalizedDays) {
      const parsed = Number.parseInt(normalizedDays, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        setFormError("Expiry must be a positive integer (days).");
        return;
      }
      payloadDays = parsed;
    }
    setCreating(true);
    try {
      const created = await createApiToken({
        name: normalizedName,
        expires_in_days: payloadDays,
      });
      setRevealedToken({ value: created.access_token, token: created.api_token });
      setCopyMessage(null);
      setActionMessage("API token created.");
      setShowCreateModal(false);
      await loadTokens();
    } catch (createError) {
      setFormError(extractError(createError));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: ApiTokenInfo) => {
    const status = resolveTokenStatus(token);
    if (status !== "active") return;
    if (!confirmAction(`Revoke API token '${token.name}'?`)) return;
    setBusyTokenId(token.id);
    setActionMessage(null);
    setError(null);
    try {
      await revokeApiToken(token.id);
      setActionMessage("API token revoked.");
      await loadTokens();
    } catch (revokeError) {
      setError(extractError(revokeError));
    } finally {
      setBusyTokenId(null);
    }
  };

  const copyAndNotify = async (value: string, message: string) => {
    try {
      await copyToClipboard(value);
      setCopyMessage(message);
      window.setTimeout(() => setCopyMessage(null), 2500);
    } catch (copyError) {
      setError(extractError(copyError));
    }
  };

  const authHeaderSnippet = revealedToken ? `Authorization: Bearer ${revealedToken.value}` : "";
  const curlSnippet = revealedToken
    ? [
        `curl -X GET "${apiBase}/admin/users/minimal" \\`,
        `  -H "Authorization: Bearer ${revealedToken.value}"`,
      ].join("\n")
    : "";
  const ansibleSnippet = revealedToken
    ? [
        "headers:",
        `  Authorization: "Bearer ${revealedToken.value}"`,
        '  Content-Type: "application/json"',
      ].join("\n")
    : "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="API tokens"
        description="Manage long-lived admin tokens for automation and integrations."
        breadcrumbs={[
          { label: "Admin" },
          { label: "API tokens" },
        ]}
        rightContent={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 ui-caption text-slate-600 dark:border-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(event) => setIncludeRevoked(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              Show revoked/expired
            </label>
            <button
              type="button"
              onClick={loadTokens}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
            >
              Create token
            </button>
          </div>
        }
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {copyMessage && <PageBanner tone="info">{copyMessage}</PageBanner>}

      {revealedToken && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">New API token: {revealedToken.token.name}</p>
              <p className="ui-caption text-amber-700 dark:text-amber-200">
                This token is shown only once. Store it securely now.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 ui-caption font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-100">
              One-time display
            </span>
          </div>
          <div className="mt-3 rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
            {revealedToken.value}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => copyAndNotify(revealedToken.value, "Token copied to clipboard.")}
            >
              Copy token
            </button>
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => copyAndNotify(authHeaderSnippet, "Authorization header copied.")}
            >
              Copy auth header
            </button>
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => copyAndNotify(curlSnippet, "cURL example copied.")}
            >
              Copy cURL
            </button>
            <button
              type="button"
              className={tableActionButtonClasses}
              onClick={() => copyAndNotify(ansibleSnippet, "Ansible header snippet copied.")}
            >
              Copy Ansible
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="compact-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Created</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Expires</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Last used</th>
              <th className="px-6 py-3 text-left ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
              <th className="px-6 py-3 text-right ui-caption font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {loading && <TableEmptyState colSpan={6} message="Loading API tokens..." />}
            {!loading && sortedTokens.length === 0 && <TableEmptyState colSpan={6} message="No API token found." />}
            {!loading &&
              sortedTokens.map((token) => {
                const status = resolveTokenStatus(token);
                const isBusy = busyTokenId === token.id;
                return (
                  <tr key={token.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4 ui-body font-semibold text-slate-800 dark:text-slate-100">{token.name}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{formatDate(token.created_at)}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{formatDate(token.expires_at)}</td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{formatDate(token.last_used_at)}</td>
                    <td className="px-6 py-4 ui-body text-slate-700 dark:text-slate-200">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      {status === "active" ? (
                        <button
                          type="button"
                          onClick={() => handleRevoke(token)}
                          disabled={isBusy}
                          className={tableDeleteActionClasses}
                        >
                          {isBusy ? "Revoking..." : "Revoke"}
                        </button>
                      ) : (
                        <span className="ui-caption text-slate-400 dark:text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <Modal title="Create API token" onClose={closeCreateModal} maxWidthClass="max-w-xl">
          <form className="space-y-4" onSubmit={handleCreate}>
            <p className="ui-caption text-slate-500 dark:text-slate-400">
              Create a long-lived JWT token for automation (Ansible, CI, scripts). The token secret will be shown once.
            </p>
            <div className="space-y-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Token name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                placeholder="ansible-production"
                maxLength={128}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Expiry (days)</label>
              <input
                type="number"
                min={1}
                step={1}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Leave the default value unless you need a shorter or longer validity.
              </p>
            </div>
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeCreateModal}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200 dark:hover:border-primary-500 dark:hover:text-primary-200"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-60"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create token"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
