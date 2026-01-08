/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import PageTabs from "../../components/PageTabs";
import {
  ObjectAcl,
  ObjectLegalHold,
  ObjectMetadata,
  ObjectMetadataUpdate,
  ObjectRetention,
  ObjectRestoreRequest,
  ObjectTag,
  type PresignedUrl,
  updateObjectAcl,
  updateObjectLegalHold,
  updateObjectMetadata,
  updateObjectRetention,
  updateObjectTags,
  getObjectLegalHold,
  getObjectRetention,
  presignObject,
  restoreObject,
} from "../../api/browser";
import { S3AccountSelector } from "../../api/accountParams";

type TargetObject = {
  key: string;
  name: string;
  type: "file" | "folder";
  storageClass?: string | null;
};

type ObjectAdvancedModalProps = {
  accountId: S3AccountSelector;
  bucketName: string;
  item: TargetObject;
  metadata: ObjectMetadata | null;
  tags: ObjectTag[];
  tagsVersionId?: string | null;
  onClose: () => void;
  onRefresh?: (key: string) => Promise<void> | void;
};

type MetadataDraft = {
  contentType: string;
  cacheControl: string;
  contentDisposition: string;
  contentEncoding: string;
  contentLanguage: string;
  expires: string;
};

const inputClasses =
  "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 ui-caption text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const buttonPrimaryClasses =
  "inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60";
const buttonGhostClasses =
  "inline-flex items-center justify-center rounded-md px-2 py-1 ui-caption font-semibold text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";

const storageClassOptions = [
  { value: "STANDARD", label: "STANDARD" },
  { value: "STANDARD_IA", label: "STANDARD_IA" },
  { value: "ONEZONE_IA", label: "ONEZONE_IA" },
  { value: "INTELLIGENT_TIERING", label: "INTELLIGENT_TIERING" },
  { value: "GLACIER", label: "GLACIER" },
  { value: "GLACIER_IR", label: "GLACIER_IR" },
  { value: "DEEP_ARCHIVE", label: "DEEP_ARCHIVE" },
];

const aclOptions = [
  { value: "private", label: "private" },
  { value: "public-read", label: "public-read" },
  { value: "public-read-write", label: "public-read-write" },
  { value: "authenticated-read", label: "authenticated-read" },
  { value: "bucket-owner-read", label: "bucket-owner-read" },
  { value: "bucket-owner-full-control", label: "bucket-owner-full-control" },
  { value: "aws-exec-read", label: "aws-exec-read" },
];

const formatLocalDateTime = (value?: string | Date | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => `${num}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
};

const toIsoString = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const normalizePairs = (items: ObjectTag[]) =>
  items.reduce<Record<string, string>>((acc, item) => {
    const key = item.key.trim();
    if (!key) return acc;
    acc[key] = item.value ?? "";
    return acc;
  }, {});

export default function ObjectAdvancedModal({
  accountId,
  bucketName,
  item,
  metadata,
  tags,
  tagsVersionId,
  onClose,
  onRefresh,
}: ObjectAdvancedModalProps) {
  const makeDraftId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  type TagDraft = ObjectTag & { id: string };

  const [activeTab, setActiveTab] = useState("metadata");
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({
    contentType: "",
    cacheControl: "",
    contentDisposition: "",
    contentEncoding: "",
    contentLanguage: "",
    expires: "",
  });
  const [metadataItems, setMetadataItems] = useState<ObjectTag[]>([]);
  const [tagsDraft, setTagsDraft] = useState<TagDraft[]>([]);
  const [storageClass, setStorageClass] = useState("");
  const [aclValue, setAclValue] = useState("private");
  const [legalHoldStatus, setLegalHoldStatus] = useState<"ON" | "OFF">("OFF");
  const [legalHoldLoading, setLegalHoldLoading] = useState(false);
  const [legalHoldError, setLegalHoldError] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<"" | "GOVERNANCE" | "COMPLIANCE">("");
  const [retentionDate, setRetentionDate] = useState("");
  const [retentionBypass, setRetentionBypass] = useState(false);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [restoreDays, setRestoreDays] = useState("7");
  const [restoreTier, setRestoreTier] = useState<"Standard" | "Bulk" | "Expedited">("Standard");
  const [presignExpires, setPresignExpires] = useState("");
  const [presignUrl, setPresignUrl] = useState("");
  const [presignMethod, setPresignMethod] = useState("");
  const [presignFields, setPresignFields] = useState<PresignedUrl["fields"] | null>(null);
  const [presignError, setPresignError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<"success" | "error" | null>(null);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [savingStorage, setSavingStorage] = useState(false);
  const [savingAcl, setSavingAcl] = useState(false);
  const [savingLegalHold, setSavingLegalHold] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [savingRestore, setSavingRestore] = useState(false);
  const [savingPresign, setSavingPresign] = useState(false);

  const versionId = metadata?.version_id ?? tagsVersionId ?? undefined;

  useEffect(() => {
    setActiveTab("metadata");
    setActionMessage(null);
    setActionTone(null);
    setPresignUrl("");
    setPresignMethod("");
    setPresignFields(null);
    setPresignError(null);
    setPresignExpires(formatLocalDateTime(new Date(Date.now() + 60 * 60 * 1000)));
  }, [item.key]);

  useEffect(() => {
    if (!metadata) {
      setMetadataDraft({
        contentType: "",
        cacheControl: "",
        contentDisposition: "",
        contentEncoding: "",
        contentLanguage: "",
        expires: "",
      });
      setMetadataItems([]);
      setStorageClass(item.storageClass ?? "");
      return;
    }
    setMetadataDraft({
      contentType: metadata.content_type ?? "",
      cacheControl: metadata.cache_control ?? "",
      contentDisposition: metadata.content_disposition ?? "",
      contentEncoding: metadata.content_encoding ?? "",
      contentLanguage: metadata.content_language ?? "",
      expires: formatLocalDateTime(metadata.expires),
    });
    setMetadataItems(Object.entries(metadata.metadata || {}).map(([key, value]) => ({ key, value })));
    setStorageClass(metadata.storage_class ?? item.storageClass ?? "");
  }, [item.storageClass, metadata]);

  useEffect(() => {
    setTagsDraft(tags.map((tag) => ({ id: makeDraftId(), key: tag.key, value: tag.value })));
  }, [item.key, tags]);

  useEffect(() => {
    let isMounted = true;
    setLegalHoldLoading(true);
    setLegalHoldError(null);
    getObjectLegalHold(accountId, bucketName, item.key, versionId ?? null)
      .then((data) => {
        if (!isMounted) return;
        setLegalHoldStatus(data.status === "ON" ? "ON" : "OFF");
      })
      .catch(() => {
        if (!isMounted) return;
        setLegalHoldError("Unable to load legal hold status.");
      })
      .finally(() => {
        if (isMounted) {
          setLegalHoldLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountId, bucketName, item.key, versionId]);

  useEffect(() => {
    let isMounted = true;
    setRetentionLoading(true);
    setRetentionError(null);
    getObjectRetention(accountId, bucketName, item.key, versionId ?? null)
      .then((data) => {
        if (!isMounted) return;
        setRetentionMode(data.mode ?? "");
        setRetentionDate(formatLocalDateTime(data.retain_until));
      })
      .catch(() => {
        if (!isMounted) return;
        setRetentionError("Unable to load retention settings.");
      })
      .finally(() => {
        if (isMounted) {
          setRetentionLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [accountId, bucketName, item.key, versionId]);

  const statusClassName = useMemo(() => {
    if (!actionTone) return "";
    if (actionTone === "error") {
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/30 dark:text-rose-100";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/30 dark:text-emerald-100";
  }, [actionTone]);

  const pushStatus = (message: string, tone: "success" | "error") => {
    setActionMessage(message);
    setActionTone(tone);
  };

  const handleSaveMetadata = async () => {
    if (!bucketName || !item.key) return;
    setSavingMetadata(true);
    setActionMessage(null);
    try {
      const payload: ObjectMetadataUpdate = {
        key: item.key,
        version_id: versionId ?? null,
        content_type: metadataDraft.contentType,
        cache_control: metadataDraft.cacheControl,
        content_disposition: metadataDraft.contentDisposition,
        content_encoding: metadataDraft.contentEncoding,
        content_language: metadataDraft.contentLanguage,
        expires: toIsoString(metadataDraft.expires),
        metadata: normalizePairs(metadataItems),
      };
      await updateObjectMetadata(accountId, bucketName, payload);
      pushStatus("Metadata updated.", "success");
      await onRefresh?.(item.key);
    } catch (err) {
      pushStatus("Unable to update metadata.", "error");
    } finally {
      setSavingMetadata(false);
    }
  };

  const handleSaveTags = async () => {
    if (!bucketName || !item.key) return;
    setSavingTags(true);
    setActionMessage(null);
    try {
      await updateObjectTags(accountId, bucketName, {
        key: item.key,
        version_id: versionId ?? null,
        tags: tagsDraft
          .filter((tag) => tag.key.trim().length > 0)
          .map(({ key, value }) => ({ key, value })),
      });
      pushStatus("Tags updated.", "success");
      await onRefresh?.(item.key);
    } catch (err) {
      pushStatus("Unable to update tags.", "error");
    } finally {
      setSavingTags(false);
    }
  };

  const handleSaveStorageClass = async () => {
    if (!bucketName || !item.key || !storageClass) return;
    setSavingStorage(true);
    setActionMessage(null);
    try {
      const payload: ObjectMetadataUpdate = {
        key: item.key,
        version_id: versionId ?? null,
        storage_class: storageClass,
      };
      await updateObjectMetadata(accountId, bucketName, payload);
      pushStatus("Storage class updated.", "success");
      await onRefresh?.(item.key);
    } catch (err) {
      pushStatus("Unable to update storage class.", "error");
    } finally {
      setSavingStorage(false);
    }
  };

  const handleSaveAcl = async () => {
    if (!bucketName || !item.key) return;
    setSavingAcl(true);
    setActionMessage(null);
    try {
      const payload: ObjectAcl = { key: item.key, acl: aclValue, version_id: versionId ?? null };
      await updateObjectAcl(accountId, bucketName, payload);
      pushStatus("ACL updated.", "success");
    } catch (err) {
      pushStatus("Unable to update ACL.", "error");
    } finally {
      setSavingAcl(false);
    }
  };

  const handleSaveLegalHold = async () => {
    if (!bucketName || !item.key) return;
    setSavingLegalHold(true);
    setActionMessage(null);
    try {
      const payload: ObjectLegalHold = { key: item.key, status: legalHoldStatus, version_id: versionId ?? null };
      await updateObjectLegalHold(accountId, bucketName, payload);
      pushStatus("Legal hold updated.", "success");
      await onRefresh?.(item.key);
    } catch (err) {
      pushStatus("Unable to update legal hold.", "error");
    } finally {
      setSavingLegalHold(false);
    }
  };

  const handleSaveRetention = async () => {
    if (!bucketName || !item.key || !retentionMode || !retentionDate) return;
    const retainUntil = toIsoString(retentionDate);
    if (!retainUntil) {
      pushStatus("Retention date is invalid.", "error");
      return;
    }
    setSavingRetention(true);
    setActionMessage(null);
    try {
      const payload: ObjectRetention = {
        key: item.key,
        mode: retentionMode,
        retain_until: retainUntil,
        bypass_governance: retentionBypass,
        version_id: versionId ?? null,
      };
      await updateObjectRetention(accountId, bucketName, payload);
      pushStatus("Retention updated.", "success");
      await onRefresh?.(item.key);
    } catch (err) {
      pushStatus("Unable to update retention.", "error");
    } finally {
      setSavingRetention(false);
    }
  };

  const handleRestore = async () => {
    if (!bucketName || !item.key) return;
    const days = Number(restoreDays);
    if (!Number.isFinite(days) || days <= 0) {
      pushStatus("Restore days must be a positive number.", "error");
      return;
    }
    setSavingRestore(true);
    setActionMessage(null);
    try {
      const payload: ObjectRestoreRequest = {
        key: item.key,
        days,
        tier: restoreTier,
        version_id: versionId ?? null,
      };
      await restoreObject(accountId, bucketName, payload);
      pushStatus("Restore request sent.", "success");
    } catch (err) {
      pushStatus("Unable to restore object.", "error");
    } finally {
      setSavingRestore(false);
    }
  };

  const handleGeneratePresign = async () => {
    if (!bucketName || !item.key) return;
    setPresignError(null);
    const expiresAt = presignExpires ? new Date(presignExpires) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      setPresignError("Select a valid expiration date.");
      return;
    }
    const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (seconds < 60) {
      setPresignError("Expiration must be at least 1 minute from now.");
      return;
    }
    if (seconds > 43200) {
      setPresignError("Expiration must be within 12 hours.");
      return;
    }
    setSavingPresign(true);
    try {
      const presigned = await presignObject(accountId, bucketName, {
        key: item.key,
        operation: "get_object",
        expires_in: seconds,
      });
      setPresignUrl(presigned.url);
      setPresignMethod(presigned.method);
      setPresignFields(presigned.fields ?? null);
      pushStatus("Signed URL generated.", "success");
    } catch (err) {
      setPresignError("Unable to generate signed URL.");
      pushStatus("Unable to generate signed URL.", "error");
    } finally {
      setSavingPresign(false);
    }
  };

  const handleCopyPresign = async () => {
    if (!presignUrl) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(presignUrl);
      pushStatus("URL copied to clipboard.", "success");
    } else {
      window.prompt("Copy URL:", presignUrl);
    }
  };

  const tabs = [
    {
      id: "metadata",
      label: "Metadata",
      content: (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Content type</span>
              <input
                className={inputClasses}
                value={metadataDraft.contentType}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, contentType: event.target.value }))}
                placeholder="application/octet-stream"
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Cache control</span>
              <input
                className={inputClasses}
                value={metadataDraft.cacheControl}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, cacheControl: event.target.value }))}
                placeholder="max-age=3600"
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Content disposition</span>
              <input
                className={inputClasses}
                value={metadataDraft.contentDisposition}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, contentDisposition: event.target.value }))}
                placeholder="inline"
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Content encoding</span>
              <input
                className={inputClasses}
                value={metadataDraft.contentEncoding}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, contentEncoding: event.target.value }))}
                placeholder="gzip"
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Content language</span>
              <input
                className={inputClasses}
                value={metadataDraft.contentLanguage}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, contentLanguage: event.target.value }))}
                placeholder="en"
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Expires</span>
              <input
                type="datetime-local"
                className={inputClasses}
                value={metadataDraft.expires}
                onChange={(event) => setMetadataDraft((prev) => ({ ...prev, expires: event.target.value }))}
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Custom metadata</p>
              <button
                type="button"
                className={buttonGhostClasses}
                onClick={() => setMetadataItems((prev) => [...prev, { key: "", value: "" }])}
              >
                Add metadata
              </button>
            </div>
            {metadataItems.length === 0 ? (
              <p className="ui-caption text-slate-500 dark:text-slate-400">No custom metadata defined.</p>
            ) : (
              <div className="space-y-2">
                {metadataItems.map((item, idx) => (
                  <div key={`${item.key}-${idx}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                    <input
                      className={inputClasses}
                      value={item.key}
                      onChange={(event) =>
                        setMetadataItems((prev) =>
                          prev.map((entry, index) => (index === idx ? { ...entry, key: event.target.value } : entry))
                        )
                      }
                      placeholder="x-custom-key"
                    />
                    <input
                      className={inputClasses}
                      value={item.value}
                      onChange={(event) =>
                        setMetadataItems((prev) =>
                          prev.map((entry, index) => (index === idx ? { ...entry, value: event.target.value } : entry))
                        )
                      }
                      placeholder="value"
                    />
                    <button
                      type="button"
                      className={buttonGhostClasses}
                      onClick={() => setMetadataItems((prev) => prev.filter((_, index) => index !== idx))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={buttonPrimaryClasses}
              onClick={handleSaveMetadata}
              disabled={savingMetadata || !metadata}
            >
              {savingMetadata ? "Saving..." : "Save metadata"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "tags",
      label: "Tags",
      content: (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Tags</p>
            <button
              type="button"
              className={buttonGhostClasses}
              onClick={() => setTagsDraft((prev) => [...prev, { id: makeDraftId(), key: "", value: "" }])}
            >
              Add tag
            </button>
          </div>
          {tagsDraft.length === 0 ? (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No tags defined.</p>
          ) : (
            <div className="space-y-2">
              {tagsDraft.map((tag) => (
                <div key={tag.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    className={inputClasses}
                    value={tag.key}
                    onChange={(event) =>
                      setTagsDraft((prev) =>
                        prev.map((entry) => (entry.id === tag.id ? { ...entry, key: event.target.value } : entry))
                      )
                    }
                    placeholder="Key"
                  />
                  <input
                    className={inputClasses}
                    value={tag.value}
                    onChange={(event) =>
                      setTagsDraft((prev) =>
                        prev.map((entry) => (entry.id === tag.id ? { ...entry, value: event.target.value } : entry))
                      )
                    }
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    className={buttonGhostClasses}
                    onClick={() => setTagsDraft((prev) => prev.filter((entry) => entry.id !== tag.id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end">
            <button type="button" className={buttonPrimaryClasses} onClick={handleSaveTags} disabled={savingTags}>
              {savingTags ? "Saving..." : "Save tags"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "storage",
      label: "Storage class",
      content: (
        <div className="space-y-3">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Storage class</span>
            <select
              className={inputClasses}
              value={storageClass}
              onChange={(event) => setStorageClass(event.target.value)}
            >
              <option value="">Select storage class</option>
              {storageClassOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Changing storage class triggers a copy of the object with the new storage tier.
          </p>
          <div className="flex items-center justify-end">
            <button
              type="button"
              className={buttonPrimaryClasses}
              onClick={handleSaveStorageClass}
              disabled={savingStorage || !storageClass}
            >
              {savingStorage ? "Saving..." : "Save storage class"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "acl",
      label: "ACL",
      content: (
        <div className="space-y-3">
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Canned ACL</span>
            <select className={inputClasses} value={aclValue} onChange={(event) => setAclValue(event.target.value)}>
              {aclOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Updating the ACL overrides any custom grants currently applied.
          </p>
          <div className="flex items-center justify-end">
            <button type="button" className={buttonPrimaryClasses} onClick={handleSaveAcl} disabled={savingAcl}>
              {savingAcl ? "Saving..." : "Save ACL"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "lock",
      label: "Object lock",
      content: (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Legal hold</p>
              {legalHoldLoading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading...</span>}
            </div>
            {legalHoldError && <p className="mt-2 ui-caption text-rose-600 dark:text-rose-200">{legalHoldError}</p>}
            <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
              <select
                className={inputClasses}
                value={legalHoldStatus}
                onChange={(event) => setLegalHoldStatus(event.target.value as "ON" | "OFF")}
              >
                <option value="OFF">OFF</option>
                <option value="ON">ON</option>
              </select>
              <button
                type="button"
                className={buttonPrimaryClasses}
                onClick={handleSaveLegalHold}
                disabled={savingLegalHold}
              >
                {savingLegalHold ? "Saving..." : "Update legal hold"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Retention</p>
              {retentionLoading && <span className="ui-caption text-slate-500 dark:text-slate-400">Loading...</span>}
            </div>
            {retentionError && <p className="mt-2 ui-caption text-rose-600 dark:text-rose-200">{retentionError}</p>}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Mode</span>
                <select
                  className={inputClasses}
                  value={retentionMode}
                  onChange={(event) => setRetentionMode(event.target.value as "" | "GOVERNANCE" | "COMPLIANCE")}
                >
                  <option value="">Select mode</option>
                  <option value="GOVERNANCE">GOVERNANCE</option>
                  <option value="COMPLIANCE">COMPLIANCE</option>
                </select>
              </label>
              <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
                <span>Retain until</span>
                <input
                  type="datetime-local"
                  className={inputClasses}
                  value={retentionDate}
                  onChange={(event) => setRetentionDate(event.target.value)}
                />
              </label>
            </div>
            <label className="mt-2 flex items-center gap-2 ui-caption text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                checked={retentionBypass}
                onChange={(event) => setRetentionBypass(event.target.checked)}
              />
              Bypass governance retention
            </label>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                className={buttonPrimaryClasses}
                onClick={handleSaveRetention}
                disabled={savingRetention || !retentionMode || !retentionDate}
              >
                {savingRetention ? "Saving..." : "Update retention"}
              </button>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "restore",
      label: "Restore",
      content: (
        <div className="space-y-3">
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Restore archived objects (GLACIER, DEEP_ARCHIVE) for a limited duration.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Days</span>
              <input
                type="number"
                min={1}
                className={inputClasses}
                value={restoreDays}
                onChange={(event) => setRestoreDays(event.target.value)}
              />
            </label>
            <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
              <span>Tier</span>
              <select
                className={inputClasses}
                value={restoreTier}
                onChange={(event) => setRestoreTier(event.target.value as "Standard" | "Bulk" | "Expedited")}
              >
                <option value="Standard">Standard</option>
                <option value="Bulk">Bulk</option>
                <option value="Expedited">Expedited</option>
              </select>
            </label>
          </div>
          <div className="flex items-center justify-end">
            <button type="button" className={buttonPrimaryClasses} onClick={handleRestore} disabled={savingRestore}>
              {savingRestore ? "Submitting..." : "Request restore"}
            </button>
          </div>
        </div>
      ),
    },
    {
      id: "presign",
      label: "Signed URL",
      content: (
        <div className="space-y-3">
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            Generate a temporary signed URL for this object (valid for up to 12 hours).
          </p>
          <label className="space-y-1 ui-caption font-semibold text-slate-600 dark:text-slate-300">
            <span>Expires at</span>
            <input
              type="datetime-local"
              className={inputClasses}
              value={presignExpires}
              onChange={(event) => setPresignExpires(event.target.value)}
            />
          </label>
          {presignError && <p className="ui-caption font-semibold text-rose-600 dark:text-rose-200">{presignError}</p>}
          <div className="flex items-center justify-end">
            <button
              type="button"
              className={buttonPrimaryClasses}
              onClick={handleGeneratePresign}
              disabled={savingPresign}
            >
              {savingPresign ? "Generating..." : "Generate URL"}
            </button>
          </div>
          {presignUrl && (
            <div className="space-y-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-3 ui-caption dark:border-slate-700 dark:bg-slate-900/40">
              <div className="flex items-center justify-between">
                <span className="ui-caption font-semibold text-slate-600 dark:text-slate-300">
                  {presignMethod || "GET"}
                </span>
                <button type="button" className={buttonGhostClasses} onClick={handleCopyPresign}>
                  Copy URL
                </button>
              </div>
              <textarea
                className={`${inputClasses} h-24 font-mono`}
                readOnly
                value={presignUrl}
                spellCheck={false}
              />
              {presignFields && Object.keys(presignFields).length > 0 && (
                <div className="space-y-1">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-400">Fields</p>
                  <pre className="overflow-auto rounded-md bg-slate-900/90 p-2 ui-caption text-slate-100">
                    {JSON.stringify(presignFields, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <Modal title={`Advanced operations · ${item.name}`} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          <span className="font-semibold text-slate-700 dark:text-slate-100">{bucketName}</span> / {item.key}
        </div>
        {actionMessage && (
          <div className={`rounded-lg border px-3 py-2 ui-caption font-semibold ${statusClassName}`}>{actionMessage}</div>
        )}
        <PageTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      </div>
    </Modal>
  );
}
