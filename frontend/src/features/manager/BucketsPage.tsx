/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bucket,
  createBucket,
  deleteBucket,
  listBuckets,
} from "../../api/buckets";
import { S3AccountSelector } from "../../api/accountParams";
import { useS3AccountContext } from "./S3AccountContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import Modal from "../../components/Modal";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction, confirmDeletion } from "../../utils/confirm";

type BucketForm = {
  name: string;
  location: string;
  versioning: boolean;
  encryption: string;
};

const defaultForm: BucketForm = {
  name: "",
  location: "",
  versioning: false,
  encryption: "",
};

const buildDefaultForm = (): BucketForm => ({
  ...defaultForm,
});

function QuotaBar({ usedBytes, quotaBytes }: { usedBytes?: number | null; quotaBytes?: number | null }) {
  if (!quotaBytes || quotaBytes <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedBytes ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaBytes) * 100));
  const usedDisplay = formatBytes(used);
  const quotaDisplay = formatBytes(quotaBytes);
  return (
    <div className="flex items-center gap-2" title={`${usedDisplay} / ${quotaDisplay}`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

function QuotaObjectsBar({ usedObjects, quotaObjects }: { usedObjects?: number | null; quotaObjects?: number | null }) {
  if (!quotaObjects || quotaObjects <= 0) {
    return <span className="ui-body text-slate-500 dark:text-slate-400">-</span>;
  }
  const used = usedObjects ?? 0;
  const ratio = Math.min(100, Math.round((used / quotaObjects) * 100));
  return (
    <div className="flex items-center gap-2" title={`${used.toLocaleString()} / ${quotaObjects.toLocaleString()} objects`}>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full bg-primary-500" style={{ width: `${ratio}%` }} />
      </div>
      <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">{ratio}%</span>
    </div>
  );
}

const formatBytes = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
};

const formatNumber = (value?: number | null) => {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
};

export default function BucketsPage() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection, sessionS3AccountName, accountIdForApi } = useS3AccountContext();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [bucketForm, setBucketForm] = useState<BucketForm>(buildDefaultForm);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: keyof Bucket; direction: "asc" | "desc" }>({
    field: "used_bytes",
    direction: "desc",
  });

  const bucketTableColumns: { label: string; field?: keyof Bucket | null; align?: "left" | "right" }[] = [
    { label: "Name", field: "name" },
    { label: "Used", field: "used_bytes" },
    { label: "Quota", field: "quota_max_size_bytes" },
    { label: "Objects", field: "object_count" },
    { label: "Object quota", field: "quota_max_objects" },
    { label: "Created on", field: null },
    { label: "Actions", field: null, align: "right" },
  ];

  const selectedS3Account = useMemo(
    () => accounts.find((a) => a.id === selectedS3AccountId),
    [accounts, selectedS3AccountId]
  );
  const accountLabel = selectedS3Account
    ? selectedS3Account.display_name
    : requiresS3AccountSelection
      ? "Not selected"
      : sessionS3AccountName || "RGW session";
  const needsS3AccountSelection = requiresS3AccountSelection && !accountIdForApi;

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

  const fetchBuckets = async (accountId: S3AccountSelector) => {
    setError(null);
    setLoading(true);
    try {
      const data = await listBuckets(accountId);
      setBuckets(data);
    } catch (err) {
      console.error(err);
      setError("Unable to fetch buckets. Ensure the backend is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (needsS3AccountSelection) {
      setLoading(false);
      setBuckets([]);
      return;
    }
    fetchBuckets(accountIdForApi ?? null);
  }, [accountIdForApi, needsS3AccountSelection]);

  const filteredBuckets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = q ? buckets.filter((b) => b.name.toLowerCase().includes(q)) : buckets;
    const sorted = [...items].sort((a, b) => {
      const aVal = (a as any)[sort.field];
      const bVal = (b as any)[sort.field];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sort.direction === "asc" ? 1 : -1;
      if (bVal == null) return sort.direction === "asc" ? -1 : 1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sort.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const diff = Number(aVal) - Number(bVal);
      return sort.direction === "asc" ? diff : -diff;
    });
    return sorted;
  }, [buckets, filter, sort]);

  const toggleSort = (field: keyof Bucket) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "desc" };
    });
  };

  const performCreate = async (
    name: string,
    versioning: boolean
  ): Promise<{ created: boolean }> => {
    if (needsS3AccountSelection) {
      setActionError("Select an account before creating a bucket.");
      return { created: false };
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createBucket(name, accountIdForApi, {
        versioning,
      });
      setActionMessage("Bucket created");
      await fetchBuckets(accountIdForApi ?? null);
      return { created: true };
    } catch (err) {
      setActionError(extractError(err));
      return { created: false };
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (needsS3AccountSelection) {
      setActionError("Select an account before creating a bucket.");
      return;
    }
    if (!bucketForm.name.trim()) {
      setActionError("Bucket name is required.");
      return;
    }
    const result = await performCreate(bucketForm.name.trim(), bucketForm.versioning);
    if (result.created) {
      setBucketForm(buildDefaultForm());
      setShowWizard(false);
      setWizardStep(0);
    }
  };

  const handleDelete = async (name: string) => {
    if (needsS3AccountSelection) return;
    const targetBucket = buckets.find((b) => b.name === name);
    if ((targetBucket?.object_count ?? 0) > 1000) {
      setActionMessage(null);
      setActionError("This bucket holds more than 1000 objects. Use an S3 client to empty it before deleting.");
      return;
    }
    if (!confirmDeletion("bucket", name)) return;

    setDeletingBucket(name);
    setActionError(null);
    setActionMessage(null);
    try {
      await deleteBucket(name, accountIdForApi, false);
      setActionMessage("Bucket deleted");
      await fetchBuckets(accountIdForApi ?? null);
      return;
    } catch (err) {
      const msg = extractError(err);
      const notEmpty = msg.toLowerCase().includes("not empty");
      const conflict = axios.isAxiosError(err) && err.response?.status === 409;
      if (notEmpty || conflict) {
        const confirmForce = confirmAction(
          `Bucket '${name}' contains objects. Delete all objects before deleting the bucket?`
        );
        if (confirmForce) {
          try {
            await deleteBucket(name, accountIdForApi, true);
            setActionMessage("Bucket and objects deleted");
            await fetchBuckets(accountIdForApi ?? null);
            return;
          } catch (forceErr) {
            setActionError(extractError(forceErr));
          } finally {
            setDeletingBucket(null);
          }
        } else {
          setDeletingBucket(null);
          return;
        }
      }
      setActionError(msg);
    } finally {
      setDeletingBucket(null);
    }
  };

  const stepTitles = ["General", "Protection"];

  const openAdvancedModal = () => {
    setBucketForm(buildDefaultForm());
    setWizardStep(0);
    setShowWizard(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buckets"
        description="Inventory of buckets for the selected account. Actions via root keys."
        breadcrumbs={[{ label: "Manager" }, { label: "Buckets" }]}
        actions={[
          {
            label: "Create bucket",
            onClick: openAdvancedModal,
          },
        ]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {requiresS3AccountSelection && !selectedS3Account && (
        <PageBanner tone="warning">Select an account before taking action.</PageBanner>
      )}

      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Buckets</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Paginated list (account root keys).</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="ui-caption text-slate-500 dark:text-slate-400">{filteredBuckets.length} bucket(s)</span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by name"
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                {bucketTableColumns.map((col) => (
                  <SortableHeader
                    key={col.label}
                    label={col.label}
                    field={col.field}
                    activeField={sort.field}
                    direction={sort.direction}
                    align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                    onSort={col.field ? (field) => toggleSort(field as keyof Bucket) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && <TableEmptyState colSpan={bucketTableColumns.length} message="Loading buckets..." />}
              {error && !loading && filteredBuckets.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="Unable to load buckets." />
              )}
              {!loading && !error && filteredBuckets.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="No buckets found." />
              )}
              {!loading &&
                !error &&
                filteredBuckets.map((bucket) => (
                  <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="manager-table-cell px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      <Link to={`/manager/buckets/${encodeURIComponent(bucket.name)}`} className="hover:text-primary-700 dark:hover:text-primary-200">
                        {bucket.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {formatBytes(bucket.used_bytes)}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      <QuotaBar usedBytes={bucket.used_bytes} quotaBytes={bucket.quota_max_size_bytes ?? null} />
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {formatNumber(bucket.object_count)}
                    </td>
                    <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      <QuotaObjectsBar usedObjects={bucket.object_count} quotaObjects={bucket.quota_max_objects ?? null} />
                    </td>
                    <td className="manager-table-cell px-6 py-4 ui-body text-slate-600 dark:text-slate-300">
                      {bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link
                          to={`/manager/buckets/${encodeURIComponent(bucket.name)}`}
                          className={tableActionButtonClasses}
                        >
                          View
                        </Link>
                        <button
                          onClick={() => handleDelete(bucket.name)}
                          className={tableDeleteActionClasses}
                          disabled={deletingBucket === bucket.name}
                        >
                          {deletingBucket === bucket.name ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showWizard && (
        <Modal title="Create bucket" onClose={() => setShowWizard(false)}>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="flex items-center gap-3">
              {stepTitles.map((title, index) => (
                <div key={title} className="flex items-center gap-2 ui-body">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border ui-caption font-semibold ${
                      index === wizardStep
                        ? "border-primary bg-primary-100/70 text-primary-800 dark:border-primary-500 dark:bg-primary-500/20 dark:text-primary-100"
                        : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <span className={index === wizardStep ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-500 dark:text-slate-400"}>
                    {title}
                  </span>
                  {index < stepTitles.length - 1 && <span className="text-slate-400 dark:text-slate-600">—</span>}
                </div>
              ))}
            </div>

            {wizardStep === 0 && (
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="ui-body font-medium text-slate-700 dark:text-slate-200">Bucket name</label>
                  <input
                    value={bucketForm.name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setBucketForm((prev) => ({ ...prev, name: value }));
                    }}
                    className="rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="ex: backups-prod"
                    required
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    DNS compatible, lowercase, numbers, and hyphens. The selected account will be used.
                  </p>
                </div>
                <div className="flex flex-col gap-2 opacity-60">
                  <label className="ui-body font-medium text-slate-500 dark:text-slate-400">Location / zone</label>
                  <input
                    value={bucketForm.location}
                    readOnly
                    disabled
                    className="rounded-md border border-dashed border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder="ex: default-placement"
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Ce placement est fixe pour cet environnement RGW.</p>
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-500 opacity-60 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>
                      Server-side encryption
                      <span className="block ui-caption text-slate-500 dark:text-slate-400">AES256, aws:kms, KMS key...</span>
                    </span>
                    <input
                      value={bucketForm.encryption}
                      readOnly
                      disabled
                      className="ml-3 w-40 rounded-md border border-dashed border-slate-300 px-2 py-1 ui-caption dark:border-slate-600 dark:bg-slate-900"
                      placeholder="ex: AES256"
                    />
                  </div>
                </div>
                <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
                  <span>
                    Versioning
                    <span className="block ui-caption text-slate-500 dark:text-slate-400">Enables version retention.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={bucketForm.versioning}
                    onChange={(e) => setBucketForm((prev) => ({ ...prev, versioning: e.target.checked }))}
                    className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                  />
                </label>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="ui-caption text-slate-500 dark:text-slate-400">
                S3Account: {accountLabel}
              </div>
              <div className="flex items-center gap-3">
                {wizardStep > 0 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setWizardStep((prev) => Math.max(prev - 1, 0));
                    }}
                    className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Previous
                  </button>
                )}
                {wizardStep < stepTitles.length - 1 ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setWizardStep((prev) => Math.min(prev + 1, stepTitles.length - 1));
                    }}
                    className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                  >
                    {creating ? "Creating..." : "Create bucket"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
