/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  CephAdminRgwUserDetail,
  createCephAdminUser,
  CreateCephAdminUserPayload,
  listCephAdminAccounts,
} from "../../api/cephAdmin";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwUserDetail) => void;
};

type QuotaUnit = "MiB" | "GiB" | "TiB";
type CapsMode = "replace" | "add" | "remove";

type AccountOption = {
  account_id: string;
  account_name?: string | null;
};

const UNIT_FACTORS: Record<QuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

const parseOptionalInt = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

const parseOptionalBytes = (value: string, unit: QuotaUnit): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * UNIT_FACTORS[unit]);
};

const capsTextToValues = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );

export default function CephAdminUserCreateModal({ endpointId, endpointUrl, onClose, onCreated }: Props) {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [uid, setUid] = useState("");
  const [tenant, setTenant] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [opMask, setOpMask] = useState("");
  const [suspended, setSuspended] = useState(false);
  const [adminFlag, setAdminFlag] = useState(false);
  const [systemFlag, setSystemFlag] = useState(false);
  const [generateKey, setGenerateKey] = useState(true);
  const [quotaEnabled, setQuotaEnabled] = useState(false);
  const [quotaSize, setQuotaSize] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<QuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CapsMode>("replace");
  const [capsText, setCapsText] = useState("");

  const [saving, setSaving] = useState(false);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<{ access_key: string; secret_key: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadAccounts = async () => {
      setAccountsLoading(true);
      setAccountsError(null);
      try {
        const response = await listCephAdminAccounts(endpointId, {
          page: 1,
          page_size: 200,
          sort_by: "account_id",
          sort_dir: "asc",
          include: ["profile"],
        });
        if (cancelled) return;
        const options = (response.items ?? [])
          .map((item) => ({ account_id: item.account_id, account_name: item.account_name }))
          .filter((item) => item.account_id)
          .sort((a, b) => {
            const aLabel = `${a.account_name ?? ""} ${a.account_id}`.trim().toLowerCase();
            const bLabel = `${b.account_name ?? ""} ${b.account_id}`.trim().toLowerCase();
            return aLabel.localeCompare(bLabel);
          });
        setAccounts(options);
      } catch (err) {
        if (cancelled) return;
        setAccountsError(extractError(err));
      } finally {
        if (!cancelled) {
          setAccountsLoading(false);
        }
      }
    };
    void loadAccounts();
    return () => {
      cancelled = true;
    };
  }, [endpointId]);

  const submit = async () => {
    setError(null);
    setStatus(null);
    setGeneratedKey(null);

    const normalizedUid = uid.trim();
    if (!normalizedUid) {
      setError("UID is required.");
      return;
    }

    const normalizedAccountId = selectedAccountId.trim() || undefined;
    const normalizedTenant = tenant.trim() || undefined;
    if (normalizedAccountId && normalizedTenant) {
      setError("Tenant cannot be used when an account is selected.");
      return;
    }

    const parsedMaxBuckets = maxBuckets.trim() ? parseOptionalInt(maxBuckets) : null;
    if (maxBuckets.trim() && parsedMaxBuckets == null) {
      setError("Max buckets must be a positive integer.");
      return;
    }

    const parsedQuotaBytes = quotaEnabled ? parseOptionalBytes(quotaSize, quotaUnit) : null;
    if (quotaEnabled && quotaSize.trim() && parsedQuotaBytes == null) {
      setError("Storage quota value is invalid.");
      return;
    }

    const parsedQuotaObjects = quotaEnabled ? parseOptionalInt(quotaObjects) : null;
    if (quotaEnabled && quotaObjects.trim() && parsedQuotaObjects == null) {
      setError("Object quota must be a positive integer.");
      return;
    }

    const payload: CreateCephAdminUserPayload = {
      uid: normalizedUid,
      account_id: normalizedAccountId,
      tenant: normalizedTenant,
      display_name: displayName.trim() || undefined,
      email: email.trim() || undefined,
      suspended,
      max_buckets: parsedMaxBuckets ?? undefined,
      op_mask: opMask.trim() || undefined,
      admin: adminFlag,
      system: systemFlag,
      account_root: normalizedAccountId ? true : undefined,
      generate_key: generateKey,
      quota_enabled: quotaEnabled ? true : undefined,
      quota_max_size_bytes: parsedQuotaBytes ?? undefined,
      quota_max_objects: parsedQuotaObjects ?? undefined,
      caps:
        capsText.trim() !== ""
          ? {
              mode: capsMode,
              values: capsTextToValues(capsText),
            }
          : undefined,
    };

    setSaving(true);
    try {
      const response = await createCephAdminUser(endpointId, payload);
      onCreated?.(response.detail);
      setGeneratedKey(response.generated_key ?? null);
      setStatus(`User ${response.detail.uid} created.`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const addConnectionDefaults = generatedKey
    ? buildCephConnectionDefaults(uid, generatedKey.access_key, {
        accountId: selectedAccountId,
        tenant,
      })
    : null;

  return (
    <Modal title="Create user" onClose={onClose} maxWidthClass="max-w-5xl">
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {status && <PageBanner tone="success">{status}</PageBanner>}
        {accountsError && <PageBanner tone="warning">Unable to load account list: {accountsError}</PageBanner>}
        {generatedKey && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Access key created. Secret is shown only once.</p>
              <button
                type="button"
                onClick={() => setShowAddConnectionModal(true)}
                className="rounded-md border border-amber-300 bg-white/70 px-3 py-1.5 ui-caption font-semibold text-amber-700 hover:bg-amber-100/70 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-100 dark:hover:bg-amber-950/40"
              >
                Ajouter comme S3 Connection
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="ui-caption uppercase tracking-wide text-amber-700 dark:text-amber-200">Access key</p>
                <p className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {generatedKey.access_key}
                </p>
              </div>
              <div>
                <p className="ui-caption uppercase tracking-wide text-amber-700 dark:text-amber-200">Secret key</p>
                <p className="rounded border border-amber-200 bg-white/80 px-3 py-2 font-mono ui-caption text-slate-800 dark:border-amber-800 dark:bg-amber-50/10 dark:text-amber-100">
                  {generatedKey.secret_key}
                </p>
              </div>
            </div>
          </div>
        )}

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Identity</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 md:col-span-2">
              Account (optional)
              <select
                value={selectedAccountId}
                onChange={(event) => setSelectedAccountId(event.target.value)}
                disabled={accountsLoading}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">No account</option>
                {accounts.map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.account_name ? `${account.account_name} (${account.account_id})` : account.account_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              UID *
              <input
                type="text"
                value={uid}
                onChange={(event) => setUid(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Tenant
              <input
                type="text"
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                placeholder="Optional"
                disabled={Boolean(selectedAccountId)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Display name
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Max buckets
              <input
                type="number"
                min={0}
                value={maxBuckets}
                onChange={(event) => setMaxBuckets(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 md:col-span-2">
              Op mask
              <input
                type="text"
                value={opMask}
                onChange={(event) => setOpMask(event.target.value)}
                placeholder="read,write,delete"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Flags and quota</h3>
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900/40">
            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={suspended} onChange={(event) => setSuspended(event.target.checked)} />
              Suspended
            </label>
            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={adminFlag} onChange={(event) => setAdminFlag(event.target.checked)} />
              Admin
            </label>
            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={systemFlag} onChange={(event) => setSystemFlag(event.target.checked)} />
              System
            </label>
            <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200 sm:col-span-2">
              <input type="checkbox" checked={generateKey} onChange={(event) => setGenerateKey(event.target.checked)} />
              Generate access key
            </label>
          </div>

          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={quotaEnabled}
              onChange={(event) => setQuotaEnabled(event.target.checked)}
              className={uiCheckboxClass}
            />
            Configure user quota
          </label>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Storage quota
              <input
                type="number"
                min={0}
                step="any"
                disabled={!quotaEnabled}
                value={quotaSize}
                onChange={(event) => setQuotaSize(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Unit
              <select
                disabled={!quotaEnabled}
                value={quotaUnit}
                onChange={(event) => setQuotaUnit(event.target.value as QuotaUnit)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="MiB">MiB</option>
                <option value="GiB">GiB</option>
                <option value="TiB">TiB</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Object quota
              <input
                type="number"
                min={0}
                step={1}
                disabled={!quotaEnabled}
                value={quotaObjects}
                onChange={(event) => setQuotaObjects(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Caps</h3>
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Caps mode
            <select
              value={capsMode}
              onChange={(event) => setCapsMode(event.target.value as CapsMode)}
              className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="replace">Replace</option>
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
            Caps (one per line)
            <textarea
              rows={3}
              spellCheck={false}
              value={capsText}
              onChange={(event) => setCapsText(event.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm hover:bg-primary-600 disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create user"}
          </button>
        </div>
      </div>

      {showAddConnectionModal && generatedKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Ajouter cette clé comme S3 Connection"
          zIndexClass="z-[60]"
          lockEndpoint
          accessKeyId={generatedKey.access_key}
          secretAccessKey={generatedKey.secret_key}
          defaultName={addConnectionDefaults.name}
          defaultEndpointId={endpointId}
          defaultEndpointUrl={endpointUrl ?? null}
          defaultProviderHint="ceph"
          defaultAccessManager={false}
          defaultAccessBrowser
          defaultOwnerType={addConnectionDefaults.owner.ownerType}
          defaultOwnerIdentifier={addConnectionDefaults.owner.ownerIdentifier}
          onClose={() => setShowAddConnectionModal(false)}
          onCreated={() => {
            setStatus("S3 connection created.");
            setError(null);
          }}
        />
      )}
    </Modal>
  );
}
