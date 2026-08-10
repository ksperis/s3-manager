/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiTokenInfo,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../../api/apiTokens";
import ListPageSection from "../../components/list/ListPageSection";
import Modal from "../../components/Modal";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableDeleteActionClasses } from "../../components/tableActionClasses";
import { toolbarCompactToggleClasses } from "../../components/toolbarControlClasses";
import { cx, uiButtonBaseClass, uiButtonVariants, uiCheckboxClass, uiInputClass } from "../../components/ui/styles";
import { extractApiError } from "../../utils/apiError";
import { copyTextToClipboard } from "../../utils/clipboard";
import { confirmAction } from "../../utils/confirm";
import { stableSignature } from "../../utils/stableSignature";

type TokenStatus = "active" | "expired" | "revoked";

type RevealedToken = {
  value: string;
  token: ApiTokenInfo;
};

const DEFAULT_EXPIRY_DAYS = 90;
const secondaryCompactButtonClass = cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-3 py-1.5 ui-caption");
const primaryCompactButtonClass = cx(uiButtonBaseClass, uiButtonVariants.primary, "px-3 py-1.5 ui-caption");
const toolbarActionButtonClass = cx(uiButtonBaseClass, uiButtonVariants.secondary, "h-8 px-3 py-1.5 ui-caption");
const toolbarPrimaryActionButtonClass = cx(uiButtonBaseClass, uiButtonVariants.primary, "h-8 px-3 py-1.5 ui-caption");

function extractError(error: unknown): string {
  return extractApiError(error, "Unable to complete request.");
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

type ApiTokensPageProps = {
  showPageHeader?: boolean;
  onUnsavedChangesChange?: (dirty: boolean) => void;
};

export default function ApiTokensPage({ showPageHeader = true, onUnsavedChangesChange }: ApiTokensPageProps) {
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
  const [createInitialSignature, setCreateInitialSignature] = useState(() =>
    stableSignature({ tokenName: "", expiresInDays: String(DEFAULT_EXPIRY_DAYS) })
  );

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
  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: sortedTokens.length,
  });

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listApiTokens(includeRevoked);
      setTokens(data);
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
    setCreateInitialSignature(stableSignature({ tokenName: "", expiresInDays: String(DEFAULT_EXPIRY_DAYS) }));
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setFormError(null);
  };

  const createCurrentSignature = useMemo(
    () => stableSignature({ tokenName, expiresInDays }),
    [expiresInDays, tokenName]
  );
  const createHasUnsavedChanges = showCreateModal && createCurrentSignature !== createInitialSignature;
  useEffect(() => {
    onUnsavedChangesChange?.(createHasUnsavedChanges);
  }, [createHasUnsavedChanges, onUnsavedChangesChange]);
  const createCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: createHasUnsavedChanges,
    onClose: closeCreateModal,
    disabled: creating,
  });

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
      await copyTextToClipboard(value);
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
  const headerActions = [
    {
      label: "Refresh",
      onClick: loadTokens,
      variant: "ghost" as const,
    },
    {
      label: "Create token",
      onClick: openCreateModal,
    },
  ];
  const tokenTableColumns: Array<DataTableColumn<ApiTokenInfo>> = [
    {
      id: "name",
      label: "Name",
      primary: true,
      render: (token) => token.name,
    },
    {
      id: "created",
      label: "Created",
      render: (token) => formatDate(token.created_at),
    },
    {
      id: "expires",
      label: "Expires",
      render: (token) => formatDate(token.expires_at),
    },
    {
      id: "last-used",
      label: "Last used",
      render: (token) => formatDate(token.last_used_at),
    },
    {
      id: "status",
      label: "Status",
      render: (token) => <StatusBadge status={resolveTokenStatus(token)} />,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      render: (token) => {
        const status = resolveTokenStatus(token);
        const isBusy = busyTokenId === token.id;
        return status === "active" ? (
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
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {showPageHeader ? (
        <PageHeader
          title="API tokens"
          description="Manage long-lived admin tokens for automation and integrations."
          breadcrumbs={adminPageBreadcrumbs("api-tokens")}
          actions={headerActions}
        />
      ) : null}

      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {copyMessage && <PageBanner tone="info">{copyMessage}</PageBanner>}

      {revealedToken && (
        <OneTimeSecretPanel
          title={`New API token: ${revealedToken.token.name}`}
          description="This token is shown only once. Store it securely now."
          badge="One-time display"
          values={[{ label: "Token", value: revealedToken.value }]}
          actions={
            <>
            <button
              type="button"
              className={secondaryCompactButtonClass}
              onClick={() => copyAndNotify(revealedToken.value, "Token copied to clipboard.")}
            >
              Copy token
            </button>
            <button
              type="button"
              className={secondaryCompactButtonClass}
              onClick={() => copyAndNotify(authHeaderSnippet, "Authorization header copied.")}
            >
              Copy auth header
            </button>
            <button
              type="button"
              className={secondaryCompactButtonClass}
              onClick={() => copyAndNotify(curlSnippet, "cURL example copied.")}
            >
              Copy cURL
            </button>
            <button
              type="button"
              className={secondaryCompactButtonClass}
              onClick={() => copyAndNotify(ansibleSnippet, "Ansible header snippet copied.")}
            >
              Copy Ansible
            </button>
            </>
          }
        />
      )}

      <ListPageSection
          title="API tokens"
          description="Manage long-lived admin tokens for automation and integrations."
          showHeading={showPageHeader === false}
          countLabel={`${sortedTokens.length} token${sortedTokens.length === 1 ? "" : "s"}${includeRevoked ? " (including revoked/expired)" : ""}`}
          filters={
            <label className={toolbarCompactToggleClasses}>
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(event) => setIncludeRevoked(event.target.checked)}
                className={uiCheckboxClass}
              />
              Show revoked/expired
            </label>
          }
          actions={
            showPageHeader
              ? undefined
              : headerActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    className={action.variant === "ghost" ? toolbarActionButtonClass : toolbarPrimaryActionButtonClass}
                  >
                    {action.label}
                  </button>
                ))
          }
      >
        <DataTableShell
          columns={tokenTableColumns}
          rows={sortedTokens}
          rowKey={(token) => token.id}
          status={tableStatus}
          loadingMessage="Loading API tokens..."
          errorMessage="Unable to load API tokens."
          emptyMessage="No API tokens."
          tableClassName="compact-table"
          responsiveCards
        />
      </ListPageSection>

      {showCreateModal && (
        <Modal title="Create API token" onClose={createCloseGuard.requestClose} maxWidthClass="max-w-xl">
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
                className={uiInputClass}
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
                className={uiInputClass}
              />
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                Leave the default value unless you need a shorter or longer validity.
              </p>
            </div>
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={createCloseGuard.requestClose}
                className={secondaryCompactButtonClass}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryCompactButtonClass}
                disabled={creating}
              >
                {creating ? "Creating..." : "Create token"}
              </button>
            </div>
          </form>
          {createCloseGuard.confirmationDialog}
        </Modal>
      )}
    </div>
  );
}
