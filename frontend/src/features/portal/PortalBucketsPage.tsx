/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { listPortalBrowserBuckets, BrowserBucket } from "../../api/portalBrowser";
import { createPortalBucket } from "../../api/portalBuckets";
import { usePortalAccountContext } from "./PortalAccountContext";

export default function PortalBucketsPage() {
  const { accountIdForApi, portalContext } = usePortalAccountContext();
  const canCreate = portalContext?.permissions?.includes("portal.bucket.create") ?? false;

  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountIdForApi) {
      setBuckets([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listPortalBrowserBuckets(accountIdForApi);
      setBuckets(data);
    } catch (err) {
      console.error(err);
      setBuckets([]);
      setError("Unable to load buckets.");
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const [bucketName, setBucketName] = useState("");
  const [versioning, setVersioning] = useState(false);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi) return;
    setError(null);
    setStatus(null);
    try {
      const created = await createPortalBucket(accountIdForApi, { name: bucketName.trim(), versioning });
      setStatus(`Bucket created: ${created.name}`);
      setBucketName("");
      setVersioning(false);
      await load();
    } catch (err) {
      console.error(err);
      setError("Unable to create bucket.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Buckets" description="Provision buckets via portal workflow." />

      {!accountIdForApi && <PageBanner tone="warning">Select an account to view buckets.</PageBanner>}
      {loading && <PageBanner tone="info">Loading…</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {status && <PageBanner tone="success">{status}</PageBanner>}

      {accountIdForApi && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Buckets</p>
            {buckets.length === 0 ? (
              <p className="mt-2 ui-body text-slate-500 dark:text-slate-400">No buckets found.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {buckets
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((b) => (
                    <li key={b.name} className="rounded-lg bg-slate-50 px-3 py-2 ui-caption dark:bg-slate-900">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{b.name}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Create bucket</p>
            {!canCreate ? (
              <PageBanner tone="warning" className="mt-3">
                You do not have permission to create buckets.
              </PageBanner>
            ) : (
              <form onSubmit={handleCreate} className="mt-3 space-y-3">
                <input
                  value={bucketName}
                  onChange={(e) => setBucketName(e.target.value)}
                  placeholder="Bucket name (lowercase)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  required
                />
                <label className="flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={versioning}
                    onChange={(e) => setVersioning(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  Enable versioning
                </label>
                <PageBanner tone="info">
                  Portal-managed buckets are tagged with <span className="font-semibold">managed-by=portal</span> and{" "}
                  <span className="font-semibold">portal-account</span>.
                </PageBanner>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
                >
                  Create bucket
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
