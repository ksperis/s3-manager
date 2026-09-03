/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  CephAdminRgwUserDetail,
  createCephAdminUser,
  CreateCephAdminUserPayload,
} from "../../api/cephAdmin";
import { listCephAdminAccounts } from "../../api/cephAdminAccounts";
import AddS3ConnectionFromKeyModal from "../../components/AddS3ConnectionFromKeyModal";
import WorkflowPage from "../../components/WorkflowPage";
import OneTimeSecretPanel from "../../components/OneTimeSecretPanel";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import UiTextarea from "../../components/ui/UiTextarea";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { canCreateManualPrivateConnections, readStoredUser } from "../../utils/workspaces";
import { buildCephConnectionDefaults } from "../shared/s3ConnectionFromKey";
import CephAdminQuotaFields from "./CephAdminQuotaFields";
import { cephAdminPageBreadcrumbs } from "./cephAdminBreadcrumbs";
import {
  parseOptionalNonNegativeInteger,
  parseQuotaBytes,
  type CephAdminQuotaUnit,
} from "./quotaForm";

type Props = {
  endpointId: number;
  endpointUrl?: string | null;
  onClose: () => void;
  onCreated?: (detail: CephAdminRgwUserDetail) => void;
};

type CapsMode = "replace" | "add" | "remove";

type AccountOption = {
  account_id: string;
  account_name?: string | null;
};

const extractError = (err: unknown): string => extractApiError(err, "Unexpected error");

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
  const canAddAsS3Connection = useMemo(
    () => canCreateManualPrivateConnections(readStoredUser()),
    []
  );
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
  const [quotaUnit, setQuotaUnit] = useState<CephAdminQuotaUnit>("GiB");
  const [quotaObjects, setQuotaObjects] = useState("");
  const [capsMode, setCapsMode] = useState<CapsMode>("replace");
  const [capsText, setCapsText] = useState("");

  const [saving, setSaving] = useState(false);
  const [showAddConnectionModal, setShowAddConnectionModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<{ access_key: string; secret_key: string } | null>(null);
  const currentSignature = useMemo(
    () =>
      stableSignature({
        selectedAccountId,
        uid,
        tenant,
        displayName,
        email,
        maxBuckets,
        opMask,
        suspended,
        adminFlag,
        systemFlag,
        generateKey,
        quotaEnabled,
        quotaSize,
        quotaUnit,
        quotaObjects,
        capsMode,
        capsText,
      }),
    [
      adminFlag,
      capsMode,
      capsText,
      displayName,
      email,
      generateKey,
      maxBuckets,
      opMask,
      quotaEnabled,
      quotaObjects,
      quotaSize,
      quotaUnit,
      selectedAccountId,
      suspended,
      systemFlag,
      tenant,
      uid,
    ]
  );
  const [initialSignature, setInitialSignature] = useState(currentSignature);
  const closeGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: currentSignature !== initialSignature,
    onClose,
    disabled: saving,
    zIndexClass: "z-[70]",
  });

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

    const parsedMaxBuckets = maxBuckets.trim() ? parseOptionalNonNegativeInteger(maxBuckets) : null;
    if (maxBuckets.trim() && parsedMaxBuckets == null) {
      setError("Max buckets must be a positive integer.");
      return;
    }

    const parsedQuotaBytes = quotaEnabled ? parseQuotaBytes(quotaSize, quotaUnit) : null;
    if (quotaEnabled && quotaSize.trim() && parsedQuotaBytes == null) {
      setError("Storage quota value is invalid.");
      return;
    }

    const parsedQuotaObjects = quotaEnabled ? parseOptionalNonNegativeInteger(quotaObjects) : null;
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
      setInitialSignature(currentSignature);
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
    <WorkflowPage
      title="Create user"
      description="Configure identity, quotas, capabilities and the initial access key on a dedicated page."
      breadcrumbs={cephAdminPageBreadcrumbs("users", { label: "Create" })}
      backLabel="Back to users"
      onBack={closeGuard.requestClose}
      width="wide"
    >
      <div className="space-y-4">
        {error && <PageBanner tone="error">{error}</PageBanner>}
        {status && <PageBanner tone="success">{status}</PageBanner>}
        {accountsError && <PageBanner tone="warning">Unable to load account list: {accountsError}</PageBanner>}
        {generatedKey && (
          <OneTimeSecretPanel
            title="Access key created"
            description="Secret is shown only once."
            values={[
              { label: "Access key", value: generatedKey.access_key, copyLabel: "Copy" },
              { label: "Secret key", value: generatedKey.secret_key, copyLabel: "Copy" },
            ]}
            actions={canAddAsS3Connection ? (
              <UiButton
                type="button"
                onClick={() => setShowAddConnectionModal(true)}
                variant="secondary"
                size="xs"
              >
                Add as S3 Connection
              </UiButton>
            ) : undefined}
          />
        )}

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Identity</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <UiSelect
              label="Account (optional)"
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={accountsLoading}
              fieldClassName="md:col-span-2"
              size="compact"
            >
              <option value="">No account</option>
              {accounts.map((account) => (
                <option key={account.account_id} value={account.account_id}>
                  {account.account_name ? `${account.account_name} (${account.account_id})` : account.account_id}
                </option>
              ))}
            </UiSelect>
            <UiInput
              label="UID *"
              type="text"
              value={uid}
              onChange={(event) => setUid(event.target.value)}
              size="compact"
            />
            <UiInput
              label="Tenant"
              type="text"
              value={tenant}
              onChange={(event) => setTenant(event.target.value)}
              placeholder="Optional"
              disabled={Boolean(selectedAccountId)}
              size="compact"
            />
            <UiInput
              label="Display name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
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
              size="compact"
            />
            <UiInput
              label="Op mask"
              type="text"
              value={opMask}
              onChange={(event) => setOpMask(event.target.value)}
              placeholder="read,write,delete"
              fieldClassName="md:col-span-2"
              size="compact"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Flags and quota</h3>
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900/40">
            <UiCheckboxField
              checked={suspended}
              onChange={(event) => setSuspended(event.target.checked)}
              className="ui-body text-slate-700 dark:text-slate-200"
            >
              Suspended
            </UiCheckboxField>
            <UiCheckboxField
              checked={adminFlag}
              onChange={(event) => setAdminFlag(event.target.checked)}
              className="ui-body text-slate-700 dark:text-slate-200"
            >
              Admin
            </UiCheckboxField>
            <UiCheckboxField
              checked={systemFlag}
              onChange={(event) => setSystemFlag(event.target.checked)}
              className="ui-body text-slate-700 dark:text-slate-200"
            >
              System
            </UiCheckboxField>
            <UiCheckboxField
              checked={generateKey}
              onChange={(event) => setGenerateKey(event.target.checked)}
              className="ui-body text-slate-700 sm:col-span-2 dark:text-slate-200"
            >
              Generate access key
            </UiCheckboxField>
          </div>

          <CephAdminQuotaFields
            title="User quota"
            enabledLabel="Configure user quota"
            enabled={quotaEnabled}
            onEnabledChange={setQuotaEnabled}
            sizeValue={quotaSize}
            onSizeChange={setQuotaSize}
            unitValue={quotaUnit}
            onUnitChange={setQuotaUnit}
            objectValue={quotaObjects}
            onObjectChange={setQuotaObjects}
          />
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="ui-body font-semibold text-slate-900 dark:text-slate-100">Caps</h3>
          <UiSelect
            label="Caps mode"
            value={capsMode}
            onChange={(event) => setCapsMode(event.target.value as CapsMode)}
            size="compact"
          >
            <option value="replace">Replace</option>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </UiSelect>
          <UiTextarea
            label="Caps (one per line)"
            rows={3}
            spellCheck={false}
            value={capsText}
            onChange={(event) => setCapsText(event.target.value)}
            className="font-mono"
            size="compact"
          />
        </section>

        <div className="sticky bottom-0 z-10 -mx-6 -mb-4 flex items-center justify-end gap-2 border-t border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] px-6 py-3">
          <UiButton
            type="button"
            onClick={closeGuard.requestClose}
            variant="secondary"
            size="sm"
          >
            Cancel
          </UiButton>
          <UiButton
            type="button"
            onClick={submit}
            disabled={saving}
            size="sm"
          >
            {saving ? "Creating..." : "Create user"}
          </UiButton>
        </div>
      </div>

      {canAddAsS3Connection && showAddConnectionModal && generatedKey && addConnectionDefaults && (
        <AddS3ConnectionFromKeyModal
          isOpen={showAddConnectionModal}
          title="Add this key as S3 Connection"
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
      {closeGuard.confirmationDialog}
    </WorkflowPage>
  );
}
