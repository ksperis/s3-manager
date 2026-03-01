/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  CephAdminRgwAccountDetail,
  createCephAdminAccount,
  CreateCephAdminAccountPayload,
} from "../../api/cephAdmin";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";

type Props = {
  endpointId: number;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwAccountDetail) => void;
};

type QuotaUnit = "MiB" | "GiB" | "TiB";

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

export default function CephAdminAccountCreateModal({ endpointId, onClose, onCreated }: Props) {
  const [accountName, setAccountName] = useState("");
  const [email, setEmail] = useState("");
  const [maxUsers, setMaxUsers] = useState("");
  const [maxBuckets, setMaxBuckets] = useState("");
  const [maxRoles, setMaxRoles] = useState("");
  const [maxGroups, setMaxGroups] = useState("");
  const [maxAccessKeys, setMaxAccessKeys] = useState("");

  const [accountQuotaEnabled, setAccountQuotaEnabled] = useState(false);
  const [accountQuotaSize, setAccountQuotaSize] = useState("");
  const [accountQuotaUnit, setAccountQuotaUnit] = useState<QuotaUnit>("GiB");
  const [accountQuotaObjects, setAccountQuotaObjects] = useState("");

  const [bucketQuotaEnabled, setBucketQuotaEnabled] = useState(false);
  const [bucketQuotaSize, setBucketQuotaSize] = useState("");
  const [bucketQuotaUnit, setBucketQuotaUnit] = useState<QuotaUnit>("GiB");
  const [bucketQuotaObjects, setBucketQuotaObjects] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setStatus(null);

    const normalizedName = accountName.trim();
    if (!normalizedName) {
      setError("Account name is required.");
      return;
    }

    const parsedMaxUsers = maxUsers.trim() ? parseOptionalInt(maxUsers) : null;
    if (maxUsers.trim() && parsedMaxUsers == null) {
      setError("Max users must be a positive integer.");
      return;
    }
    const parsedMaxBuckets = maxBuckets.trim() ? parseOptionalInt(maxBuckets) : null;
    if (maxBuckets.trim() && parsedMaxBuckets == null) {
      setError("Max buckets must be a positive integer.");
      return;
    }
    const parsedMaxRoles = maxRoles.trim() ? parseOptionalInt(maxRoles) : null;
    if (maxRoles.trim() && parsedMaxRoles == null) {
      setError("Max roles must be a positive integer.");
      return;
    }
    const parsedMaxGroups = maxGroups.trim() ? parseOptionalInt(maxGroups) : null;
    if (maxGroups.trim() && parsedMaxGroups == null) {
      setError("Max groups must be a positive integer.");
      return;
    }
    const parsedMaxAccessKeys = maxAccessKeys.trim() ? parseOptionalInt(maxAccessKeys) : null;
    if (maxAccessKeys.trim() && parsedMaxAccessKeys == null) {
      setError("Max access keys must be a positive integer.");
      return;
    }

    const parsedAccountQuotaBytes = accountQuotaEnabled ? parseOptionalBytes(accountQuotaSize, accountQuotaUnit) : null;
    if (accountQuotaEnabled && accountQuotaSize.trim() && parsedAccountQuotaBytes == null) {
      setError("Account quota size value is invalid.");
      return;
    }
    const parsedAccountQuotaObjects = accountQuotaEnabled ? parseOptionalInt(accountQuotaObjects) : null;
    if (accountQuotaEnabled && accountQuotaObjects.trim() && parsedAccountQuotaObjects == null) {
      setError("Account quota object value must be a positive integer.");
      return;
    }

    const parsedBucketQuotaBytes = bucketQuotaEnabled ? parseOptionalBytes(bucketQuotaSize, bucketQuotaUnit) : null;
    if (bucketQuotaEnabled && bucketQuotaSize.trim() && parsedBucketQuotaBytes == null) {
      setError("Bucket quota size value is invalid.");
      return;
    }
    const parsedBucketQuotaObjects = bucketQuotaEnabled ? parseOptionalInt(bucketQuotaObjects) : null;
    if (bucketQuotaEnabled && bucketQuotaObjects.trim() && parsedBucketQuotaObjects == null) {
      setError("Bucket quota object value must be a positive integer.");
      return;
    }

    const payload: CreateCephAdminAccountPayload = {
      account_name: normalizedName,
      email: email.trim() || undefined,
      max_users: parsedMaxUsers ?? undefined,
      max_buckets: parsedMaxBuckets ?? undefined,
      max_roles: parsedMaxRoles ?? undefined,
      max_groups: parsedMaxGroups ?? undefined,
      max_access_keys: parsedMaxAccessKeys ?? undefined,
      quota_enabled: accountQuotaEnabled ? true : undefined,
      quota_max_size_bytes: parsedAccountQuotaBytes ?? undefined,
      quota_max_objects: parsedAccountQuotaObjects ?? undefined,
      bucket_quota_enabled: bucketQuotaEnabled ? true : undefined,
      bucket_quota_max_size_bytes: parsedBucketQuotaBytes ?? undefined,
      bucket_quota_max_objects: parsedBucketQuotaObjects ?? undefined,
    };

    setSaving(true);
    try {
      const response = await createCephAdminAccount(endpointId, payload);
      onCreated?.(response.account);
      setStatus(`Account ${response.account.account_id} created.`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create account" onClose={onClose} maxWidthClass="max-w-5xl">
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {status && <PageBanner tone="success">{status}</PageBanner>}

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Account</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Account name *
              <input
                type="text"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="Enter account name"
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
                placeholder="Leave empty for unlimited"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Max users
              <input
                type="number"
                min={0}
                value={maxUsers}
                onChange={(event) => setMaxUsers(event.target.value)}
                placeholder="Leave empty for unlimited"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Max roles
              <input
                type="number"
                min={0}
                value={maxRoles}
                onChange={(event) => setMaxRoles(event.target.value)}
                placeholder="Leave empty for unlimited"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Max groups
              <input
                type="number"
                min={0}
                value={maxGroups}
                onChange={(event) => setMaxGroups(event.target.value)}
                placeholder="Leave empty for unlimited"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200 md:col-span-2">
              Max access keys
              <input
                type="number"
                min={0}
                value={maxAccessKeys}
                onChange={(event) => setMaxAccessKeys(event.target.value)}
                placeholder="Leave empty for unlimited"
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Account quota</h3>
          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={accountQuotaEnabled}
              onChange={(event) => setAccountQuotaEnabled(event.target.checked)}
              className={uiCheckboxClass}
            />
            Enable account quota
          </label>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Storage quota
              <input
                type="number"
                min={0}
                step="any"
                disabled={!accountQuotaEnabled}
                value={accountQuotaSize}
                onChange={(event) => setAccountQuotaSize(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Unit
              <select
                disabled={!accountQuotaEnabled}
                value={accountQuotaUnit}
                onChange={(event) => setAccountQuotaUnit(event.target.value as QuotaUnit)}
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
                disabled={!accountQuotaEnabled}
                value={accountQuotaObjects}
                onChange={(event) => setAccountQuotaObjects(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Bucket quota</h3>
          <label className="flex items-center gap-2 ui-body text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={bucketQuotaEnabled}
              onChange={(event) => setBucketQuotaEnabled(event.target.checked)}
              className={uiCheckboxClass}
            />
            Enable bucket quota
          </label>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Storage quota
              <input
                type="number"
                min={0}
                step="any"
                disabled={!bucketQuotaEnabled}
                value={bucketQuotaSize}
                onChange={(event) => setBucketQuotaSize(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-600 dark:text-slate-200">
              Unit
              <select
                disabled={!bucketQuotaEnabled}
                value={bucketQuotaUnit}
                onChange={(event) => setBucketQuotaUnit(event.target.value as QuotaUnit)}
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
                disabled={!bucketQuotaEnabled}
                value={bucketQuotaObjects}
                onChange={(event) => setBucketQuotaObjects(event.target.value)}
                className="rounded-md border border-slate-200 px-2 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
          </div>
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
            {saving ? "Creating..." : "Create account"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
