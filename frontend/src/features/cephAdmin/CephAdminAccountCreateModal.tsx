/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import {
  CephAdminRgwAccountDetail,
  createCephAdminAccount,
  CreateCephAdminAccountPayload,
} from "../../api/cephAdmin";
import WorkflowPage from "../../components/WorkflowPage";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { extractApiError } from "../../utils/apiError";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { stableSignature } from "../../utils/stableSignature";
import CephAdminQuotaFields, { type CephAdminQuotaUnit } from "./CephAdminQuotaFields";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";

type Props = {
  endpointId: number;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwAccountDetail) => void;
};

const UNIT_FACTORS: Record<CephAdminQuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

const parseOptionalInt = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

const parseOptionalBytes = (value: string, unit: CephAdminQuotaUnit): number | null => {
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
  const [accountQuotaUnit, setAccountQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [accountQuotaObjects, setAccountQuotaObjects] = useState("");

  const [bucketQuotaEnabled, setBucketQuotaEnabled] = useState(false);
  const [bucketQuotaSize, setBucketQuotaSize] = useState("");
  const [bucketQuotaUnit, setBucketQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [bucketQuotaObjects, setBucketQuotaObjects] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const currentSignature = useMemo(
    () =>
      stableSignature({
        accountName,
        email,
        maxUsers,
        maxBuckets,
        maxRoles,
        maxGroups,
        maxAccessKeys,
        accountQuotaEnabled,
        accountQuotaSize,
        accountQuotaUnit,
        accountQuotaObjects,
        bucketQuotaEnabled,
        bucketQuotaSize,
        bucketQuotaUnit,
        bucketQuotaObjects,
      }),
    [
      accountName,
      accountQuotaEnabled,
      accountQuotaObjects,
      accountQuotaSize,
      accountQuotaUnit,
      bucketQuotaEnabled,
      bucketQuotaObjects,
      bucketQuotaSize,
      bucketQuotaUnit,
      email,
      maxAccessKeys,
      maxBuckets,
      maxGroups,
      maxRoles,
      maxUsers,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: saving,
  });

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
      setInitialSignature(currentSignature);
      setStatus(`Account ${response.account.account_id} created.`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkflowPage
      title="Create account"
      description="Define the RGW account identity and quotas in a dedicated Ceph Admin workflow."
      breadcrumbs={cephAdminPageBreadcrumbs("accounts", { label: "Create" })}
      backLabel="Back to accounts"
      onBack={closeGuard.requestClose}
      width="standard"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {status && <PageBanner tone="success">{status}</PageBanner>}

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Account</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <UiInput
              label="Account name *"
              type="text"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="Enter account name"
              size="compact"
            />
            <UiInput
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              size="compact"
            />
            <UiInput
              label="Max buckets"
              type="number"
              min={0}
              value={maxBuckets}
              onChange={(event) => setMaxBuckets(event.target.value)}
              placeholder="Leave empty for unlimited"
              size="compact"
            />
            <UiInput
              label="Max users"
              type="number"
              min={0}
              value={maxUsers}
              onChange={(event) => setMaxUsers(event.target.value)}
              placeholder="Leave empty for unlimited"
              size="compact"
            />
            <UiInput
              label="Max roles"
              type="number"
              min={0}
              value={maxRoles}
              onChange={(event) => setMaxRoles(event.target.value)}
              placeholder="Leave empty for unlimited"
              size="compact"
            />
            <UiInput
              label="Max groups"
              type="number"
              min={0}
              value={maxGroups}
              onChange={(event) => setMaxGroups(event.target.value)}
              placeholder="Leave empty for unlimited"
              size="compact"
            />
            <UiInput
              label="Max access keys"
              type="number"
              min={0}
              value={maxAccessKeys}
              onChange={(event) => setMaxAccessKeys(event.target.value)}
              placeholder="Leave empty for unlimited"
              fieldClassName="md:col-span-2"
              size="compact"
            />
          </div>
        </section>

        <CephAdminQuotaFields
          title="Account quota"
          enabledLabel="Enable account quota"
          enabled={accountQuotaEnabled}
          onEnabledChange={setAccountQuotaEnabled}
          sizeValue={accountQuotaSize}
          onSizeChange={setAccountQuotaSize}
          unitValue={accountQuotaUnit}
          onUnitChange={setAccountQuotaUnit}
          objectValue={accountQuotaObjects}
          onObjectChange={setAccountQuotaObjects}
          className="bg-white p-4 dark:bg-slate-900"
        />

        <CephAdminQuotaFields
          title="Bucket quota"
          enabledLabel="Enable bucket quota"
          enabled={bucketQuotaEnabled}
          onEnabledChange={setBucketQuotaEnabled}
          sizeValue={bucketQuotaSize}
          onSizeChange={setBucketQuotaSize}
          unitValue={bucketQuotaUnit}
          onUnitChange={setBucketQuotaUnit}
          objectValue={bucketQuotaObjects}
          onObjectChange={setBucketQuotaObjects}
          className="bg-white p-4 dark:bg-slate-900"
        />

        <div className="sticky bottom-0 z-10 -mx-6 -mb-4 flex items-center justify-end gap-2 border-t border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] px-6 py-3">
          <UiButton variant="secondary" size="sm" onClick={closeGuard.requestClose}>
            Cancel
          </UiButton>
          <UiButton size="sm" onClick={submit} disabled={saving}>
            {saving ? "Creating..." : "Create account"}
          </UiButton>
        </div>
      </div>
      {closeGuard.confirmationDialog}
    </WorkflowPage>
  );
}
