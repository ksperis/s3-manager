/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import { usePortalAccountContext } from "./PortalAccountContext";
import {
  BrowserBucket,
  BrowserObject,
  ListBrowserObjectsResponse,
  PresignRequest,
  PresignedUrl,
  StsCredentials,
  getPortalStsCredentials,
  getPortalStsStatus,
  listPortalBrowserBuckets,
  listPortalBrowserObjects,
  presignPortalBrowserObject,
  deletePortalBrowserObjects,
  proxyPortalBrowserUpload,
  getPortalProxyDownloadUrl,
} from "../../api/portalBrowser";
import { presignObjectWithSts } from "../browser/stsPresigner";

function formatBytes(size?: number | null): string {
  if (size == null) return "-";
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function isStsExpiring(value: StsCredentials | null) {
  if (!value?.expiration) return true;
  const expiresAt = new Date(value.expiration).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - Date.now() <= 2 * 60 * 1000;
}

export default function PortalBrowserPage() {
  const { accountIdForApi, portalContext } = usePortalAccountContext();

  const canBrowser = portalContext?.permissions?.includes("portal.browser.view") ?? false;
  const canList = portalContext?.permissions?.includes("portal.objects.list") ?? false;
  const canGet = portalContext?.permissions?.includes("portal.objects.get") ?? false;
  const canPut = portalContext?.permissions?.includes("portal.objects.put") ?? false;
  const canDelete = portalContext?.permissions?.includes("portal.objects.delete") ?? false;

  const stsEnabled = portalContext?.endpoint?.sts_enabled ?? false;

  const [buckets, setBuckets] = useState<BrowserBucket[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);

  const [prefix, setPrefix] = useState("");
  const [objects, setObjects] = useState<BrowserObject[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [stsStatus, setStsStatus] = useState<{ available: boolean; error?: string | null } | null>(null);
  const [stsCredentials, setStsCredentials] = useState<StsCredentials | null>(null);
  const [stsLoading, setStsLoading] = useState(false);
  const stsCredsRef = useRef<StsCredentials | null>(null);
  useEffect(() => {
    stsCredsRef.current = stsCredentials;
  }, [stsCredentials]);

  const refreshSts = useCallback(
    async (force = false) => {
      if (!accountIdForApi || !stsEnabled || !canBrowser) {
        setStsStatus(null);
        setStsCredentials(null);
        return null;
      }
      const current = stsCredsRef.current;
      if (!force && current && !isStsExpiring(current)) {
        return current;
      }
      try {
        setStsLoading(true);
        const status = await getPortalStsStatus(accountIdForApi);
        setStsStatus(status);
        if (!status.available) {
          setStsCredentials(null);
          return null;
        }
        const creds = await getPortalStsCredentials(accountIdForApi);
        setStsCredentials(creds);
        return creds;
      } catch (err) {
        console.error(err);
        setStsStatus({ available: false, error: "Unable to load STS status." });
        setStsCredentials(null);
        return null;
      } finally {
        setStsLoading(false);
      }
    },
    [accountIdForApi, stsEnabled, canBrowser]
  );

  useEffect(() => {
    void refreshSts(false);
  }, [refreshSts]);

  useEffect(() => {
    if (!accountIdForApi || !canBrowser) {
      setBuckets([]);
      setBucket(null);
      return;
    }
    const load = async () => {
      setLoadingBuckets(true);
      setBucketError(null);
      try {
        const data = await listPortalBrowserBuckets(accountIdForApi);
        setBuckets(data);
        if (!bucket && data.length > 0) {
          setBucket(data[0].name);
        }
      } catch (err) {
        console.error(err);
        setBucketError("Unable to list buckets.");
        setBuckets([]);
        setBucket(null);
      } finally {
        setLoadingBuckets(false);
      }
    };
    void load();
  }, [accountIdForApi, canBrowser, bucket]);

  const loadObjects = useCallback(
    async (opts?: { append?: boolean; token?: string | null; prefixOverride?: string }) => {
      if (!accountIdForApi || !bucket || !canList) return;
      if (!opts?.append) {
        setObjectsLoading(true);
        setObjectsError(null);
      }
      try {
        const data: ListBrowserObjectsResponse = await listPortalBrowserObjects(accountIdForApi, bucket, {
          prefix: opts?.prefixOverride ?? prefix,
          continuationToken: opts?.token ?? undefined,
        });
        setPrefixes(data.prefixes);
        setNextToken(data.next_continuation_token ?? null);
        setIsTruncated(Boolean(data.is_truncated));
        setObjects((prev) => (opts?.append ? [...prev, ...data.objects] : data.objects));
      } catch (err) {
        console.error(err);
        setObjectsError("Unable to list objects for this prefix.");
        if (!opts?.append) {
          setObjects([]);
          setPrefixes([]);
        }
      } finally {
        if (!opts?.append) {
          setObjectsLoading(false);
        }
      }
    },
    [accountIdForApi, bucket, canList, prefix]
  );

  useEffect(() => {
    setSelectedKeys([]);
    setStatusMessage(null);
    if (bucket && accountIdForApi && canList) {
      void loadObjects({ append: false, token: null, prefixOverride: prefix });
    } else {
      setObjects([]);
      setPrefixes([]);
    }
  }, [bucket, prefix, accountIdForApi, canList, loadObjects]);

  const breadcrumbs = useMemo(() => {
    const parts = prefix.split("/").filter(Boolean);
    const crumbs = [{ label: "root", prefixValue: "" }];
    parts.forEach((part, idx) => {
      const value = `${parts.slice(0, idx + 1).join("/")}/`;
      crumbs.push({ label: part, prefixValue: value });
    });
    return crumbs;
  }, [prefix]);

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const presignWithBestEffort = useCallback(
    async (payload: PresignRequest): Promise<PresignedUrl> => {
      if (!accountIdForApi || !bucket) throw new Error("Missing context");
      if (stsEnabled && (stsStatus?.available ?? false)) {
        const creds = await refreshSts(false);
        if (creds) {
          try {
            return await presignObjectWithSts(creds, bucket, payload);
          } catch {
            // fall back
          }
        }
      }
      return presignPortalBrowserObject(accountIdForApi, bucket, payload);
    },
    [accountIdForApi, bucket, refreshSts, stsEnabled, stsStatus?.available]
  );

  const handleUpload = async (file: File) => {
    if (!accountIdForApi || !bucket || !canPut) return;
    const key = `${prefix}${file.name}`;
    setStatusMessage(null);
    try {
      const signed = await presignWithBestEffort({ operation: "put_object", key, content_type: file.type || undefined, expires_in: 900 });
      const resp = await fetch(signed.url, {
        method: signed.method || "PUT",
        body: file,
        headers: signed.headers ?? (file.type ? { "Content-Type": file.type } : undefined),
      });
      if (!resp.ok) {
        throw new Error(`Upload failed (${resp.status})`);
      }
      setStatusMessage(`Uploaded: ${key}`);
      await loadObjects({ append: false, token: null, prefixOverride: prefix });
    } catch (err) {
      console.error(err);
      try {
        await proxyPortalBrowserUpload(accountIdForApi, bucket, key, file);
        setStatusMessage(`Uploaded via proxy: ${key}`);
        await loadObjects({ append: false, token: null, prefixOverride: prefix });
      } catch (proxyErr) {
        console.error(proxyErr);
        setStatusMessage("Upload failed.");
      }
    }
  };

  const handleDownload = async (key: string) => {
    if (!accountIdForApi || !bucket || !canGet) return;
    setStatusMessage(null);
    try {
      const signed = await presignWithBestEffort({ operation: "get_object", key, expires_in: 900 });
      window.open(signed.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error(err);
      try {
        const url = await getPortalProxyDownloadUrl(accountIdForApi, bucket, key);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (proxyErr) {
        console.error(proxyErr);
        setStatusMessage("Download failed.");
      }
    }
  };

  const handleDelete = async () => {
    if (!accountIdForApi || !bucket || !canDelete || selectedKeys.length === 0) return;
    setStatusMessage(null);
    try {
      await deletePortalBrowserObjects(accountIdForApi, bucket, selectedKeys);
      setSelectedKeys([]);
      setStatusMessage(`Deleted ${selectedKeys.length} object(s).`);
      await loadObjects({ append: false, token: null, prefixOverride: prefix });
    } catch (err) {
      console.error(err);
      setStatusMessage("Delete failed.");
    }
  };

  const handleLoadMore = async () => {
    if (!nextToken) return;
    await loadObjects({ append: true, token: nextToken, prefixOverride: prefix });
  };

  const canShow = canBrowser && accountIdForApi;

  const uploadInput = (
    <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600">
      Upload
      <input
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = "";
        }}
        disabled={!canPut}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Browser"
        description="Basic Mode: list / upload / download / delete."
        rightContent={
          <div className="flex flex-wrap items-center gap-2">
            {uploadInput}
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || selectedKeys.length === 0}
              className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-caption font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100 dark:hover:bg-rose-900/40"
            >
              Delete
            </button>
            {stsEnabled && (
              <button
                type="button"
                onClick={() => void refreshSts(true)}
                disabled={stsLoading}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                Refresh session
              </button>
            )}
          </div>
        }
      />

      {!canBrowser && <PageBanner tone="warning">You do not have access to the integrated browser.</PageBanner>}
      {!accountIdForApi && <PageBanner tone="warning">Select an account to use the browser.</PageBanner>}
      {statusMessage && <PageBanner tone="info">{statusMessage}</PageBanner>}

      {stsEnabled && canShow && (
        <PageBanner tone={stsStatus?.available ? "success" : "warning"}>
          {stsStatus?.available ? (
            <span>
              STS session active{stsCredentials?.expiration ? ` (expires ${new Date(stsCredentials.expiration).toLocaleString()})` : ""}.
            </span>
          ) : (
            <span>STS unavailable. Falling back to backend presign/proxy. {stsStatus?.error ? `(${stsStatus.error})` : ""}</span>
          )}
        </PageBanner>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Buckets</p>
          {loadingBuckets && <p className="mt-2 ui-body text-slate-500 dark:text-slate-400">Loading…</p>}
          {bucketError && <p className="mt-2 ui-body text-rose-600">{bucketError}</p>}
          {!loadingBuckets && buckets.length === 0 && <p className="mt-2 ui-body text-slate-500 dark:text-slate-400">No buckets.</p>}
          {buckets.length > 0 && (
            <select
              value={bucket ?? ""}
              onChange={(e) => setBucket(e.target.value || null)}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 shadow-sm transition focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {buckets.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Path</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 ui-body text-slate-700 dark:text-slate-100">
                {breadcrumbs.map((crumb) => (
                  <button
                    key={crumb.prefixValue || "root"}
                    type="button"
                    onClick={() => setPrefix(crumb.prefixValue)}
                    className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  >
                    {crumb.label}
                  </button>
                ))}
              </div>
            </div>
            {isTruncated && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={!nextToken}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                Load more
              </button>
            )}
          </div>

          {objectsLoading && <PageBanner tone="info">Loading objects…</PageBanner>}
          {objectsError && <PageBanner tone="error">{objectsError}</PageBanner>}

          {canList && bucket && (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full table-fixed">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr className="text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="w-10 px-3 py-2"> </th>
                    <th className="px-3 py-2">Key</th>
                    <th className="w-28 px-3 py-2">Size</th>
                    <th className="w-28 px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {prefixes.map((p) => (
                    <tr key={p} className="border-t border-slate-200/70 dark:border-slate-800">
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 ui-body">
                        <button
                          type="button"
                          onClick={() => setPrefix(p)}
                          className="font-semibold text-primary-700 hover:underline dark:text-primary-200"
                        >
                          {p.replace(prefix, "")}
                        </button>
                      </td>
                      <td className="px-3 py-2 ui-caption text-slate-500 dark:text-slate-400">—</td>
                      <td className="px-3 py-2" />
                    </tr>
                  ))}
                  {objects.map((obj) => (
                    <tr key={obj.key} className="border-t border-slate-200/70 dark:border-slate-800">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedKeys.includes(obj.key)}
                          onChange={() => toggleSelection(obj.key)}
                          disabled={!canDelete}
                        />
                      </td>
                      <td className="px-3 py-2 ui-body text-slate-900 dark:text-slate-100">{obj.key.replace(prefix, "")}</td>
                      <td className="px-3 py-2 ui-caption text-slate-500 dark:text-slate-400">{formatBytes(obj.size)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void handleDownload(obj.key)}
                          disabled={!canGet}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary/60 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                  {prefixes.length === 0 && objects.length === 0 && !objectsLoading && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 ui-body text-slate-500 dark:text-slate-400">
                        Empty prefix.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
