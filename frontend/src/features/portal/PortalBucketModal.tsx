/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { S3AccountSelector } from "../../api/accountParams";
import { Bucket } from "../../api/buckets";
import { deleteObjects, getObjectDownloadUrl, listObjects, uploadObject, S3Object } from "../../api/objects";
import Modal from "../../components/Modal";
import PageTabs from "../../components/PageTabs";
import SplitView from "../../components/SplitView";
import UsageTile from "../../components/UsageTile";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";

type PortalBucketModalProps = {
  bucket: Bucket;
  accountId: S3AccountSelector;
  onClose: () => void;
  accountUsedBytes?: number | null;
  accountUsedObjects?: number | null;
};

type ObjectRow = { type: "prefix"; key: string; name: string } | { type: "object"; key: string; name: string; object: S3Object };

const bucketCardClasses = "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50";

const computeRelativeShare = (used?: number | null, total?: number | null) => {
  if (used == null || total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
};

export default function PortalBucketModal({
  bucket,
  accountId,
  onClose,
  accountUsedBytes,
  accountUsedObjects,
}: PortalBucketModalProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "objects">("overview");
  const [currentPrefix, setCurrentPrefix] = useState<string>("");
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setCurrentPrefix("");
    setSelectedKeys([]);
    setObjects([]);
    setPrefixes([]);
    setObjectsError(null);
    setDownloadError(null);
    setUploadError(null);
    setActionMessage(null);
    setDeleting(false);
    setUploading(false);
    setActiveTab("overview");
  }, [bucket.name]);

  const parentPrefix = useMemo(() => {
    if (!currentPrefix) return "";
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    return parts.length > 0 ? `${parts.join("/")}/` : "";
  }, [currentPrefix]);

  const objectRows = useMemo<ObjectRow[]>(() => {
    const prefixRows: ObjectRow[] = prefixes.map((prefix) => ({
      type: "prefix",
      key: prefix,
      name: prefix.replace(currentPrefix, "") || prefix,
    }));
    const objectRows: ObjectRow[] = objects.map((object) => ({
      type: "object",
      key: object.key,
      name: object.key.replace(currentPrefix, "") || object.key,
      object,
    }));
    return [...prefixRows, ...objectRows];
  }, [objects, prefixes, currentPrefix]);

  const loadObjects = useCallback(
    async (prefix: string) => {
      if (!accountId) {
        setObjects([]);
        setPrefixes([]);
        setObjectsError("Sélectionnez un compte pour explorer le bucket.");
        return;
      }
      setObjectsLoading(true);
      setObjectsError(null);
      setDownloadError(null);
      try {
        const data = await listObjects(accountId, bucket.name, prefix);
        setObjects(data.objects);
        setPrefixes(data.prefixes);
      } catch (err) {
        console.error(err);
        setObjects([]);
        setPrefixes([]);
        setObjectsError("Impossible de lister les objets du bucket.");
      } finally {
        setObjectsLoading(false);
      }
    },
    [accountId, bucket.name]
  );

  useEffect(() => {
    if (activeTab !== "objects") return;
    setSelectedKeys([]);
    loadObjects(currentPrefix);
  }, [activeTab, currentPrefix, loadObjects]);

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleDownload = async () => {
    if (!accountId || selectedKeys.length !== 1) return;
    setDownloading(true);
    setDownloadError(null);
    setActionMessage(null);
    try {
      const { url } = await getObjectDownloadUrl(accountId, bucket.name, selectedKeys[0]);
      if (url && typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        setDownloadError("URL de téléchargement indisponible.");
      }
    } catch (err) {
      console.error(err);
      setDownloadError("Impossible de récupérer le lien de téléchargement.");
    } finally {
      setDownloading(false);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!accountId || !file) return;
    setUploading(true);
    setUploadError(null);
    setActionMessage(null);
    try {
      await uploadObject(accountId, bucket.name, file, currentPrefix);
      setActionMessage(`Objet ${file.name} téléversé.`);
      await loadObjects(currentPrefix);
    } catch (err) {
      console.error(err);
      setUploadError("Impossible de téléverser cet objet.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!accountId || selectedKeys.length === 0) return;
    setDeleting(true);
    setActionMessage(null);
    setUploadError(null);
    setDownloadError(null);
    setObjectsError(null);
    try {
      await deleteObjects(accountId, bucket.name, selectedKeys);
      setActionMessage(`${selectedKeys.length} objet(s) supprimé(s).`);
      setSelectedKeys([]);
      await loadObjects(currentPrefix);
    } catch (err) {
      console.error(err);
      setObjectsError("Suppression impossible. Vérifiez vos droits.");
    } finally {
      setDeleting(false);
    }
  };

  const storageShare = computeRelativeShare(bucket.used_bytes, accountUsedBytes);
  const objectsShare = computeRelativeShare(bucket.object_count, accountUsedObjects);

  return (
    <Modal title={`Bucket ${bucket.name}`} onClose={onClose} maxWidthClass="max-w-6xl">
      <PageTabs
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as "overview" | "objects")}
        tabs={[
          {
            id: "overview",
            label: "Général",
            content: (
              <div className="space-y-4">
                <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Résumé</p>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Bucket {bucket.name}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Créé le {bucket.creation_date ? new Date(bucket.creation_date).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <UsageTile
                      label="Stockage"
                      used={bucket.used_bytes ?? null}
                      quota={bucket.quota_max_size_bytes ?? null}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      emptyHint="Aucun quota défini pour ce bucket."
                    />
                    <UsageTile
                      label="Objets"
                      used={bucket.object_count ?? null}
                      quota={bucket.quota_max_objects ?? null}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                      unitHint="objets"
                      emptyHint="Aucun quota d'objets défini."
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className={bucketCardClasses}>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Part volumétrie compte</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{storageShare != null ? formatPercentage(storageShare) : "—"}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Basé sur l'usage global du compte.</p>
                    </div>
                    <div className={bucketCardClasses}>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Part objets compte</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{objectsShare != null ? formatPercentage(objectsShare) : "—"}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Nombre d'objets vs. total compte.</p>
                    </div>
                    <div className={bucketCardClasses}>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Quota détecté</p>
                      <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {bucket.quota_max_size_bytes ? formatBytes(bucket.quota_max_size_bytes) : "Non défini"}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Stockage autorisé pour ce bucket.</p>
                    </div>
                  </div>
                </section>
              </div>
            ),
          },
          {
            id: "objects",
            label: "Parcourir",
            content: (
              <SplitView
                left={
                  <div className="p-3 space-y-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Préfixes</p>
                    <div className="space-y-1">
                      <button
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                          currentPrefix === ""
                            ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => setCurrentPrefix("")}
                      >
                        <span>(racine)</span>
                      </button>
                      {parentPrefix !== "" && (
                        <button
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                          onClick={() => setCurrentPrefix(parentPrefix)}
                        >
                          <span>⬆️ Remonter</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{parentPrefix || "/"}</span>
                        </button>
                      )}
                      {prefixes.map((prefix) => {
                        const isActive = prefix === currentPrefix;
                        const displayName = prefix.replace(currentPrefix, "") || prefix;
                        return (
                          <button
                            key={prefix}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                              isActive
                                ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            }`}
                            onClick={() => setCurrentPrefix(prefix)}
                          >
                            <span>{displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                }
                right={
                  <div className="space-y-3 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Chemin actuel</p>
                        <div className="text-xs text-slate-500 dark:text-slate-300">
                          {bucket.name}/{currentPrefix || "(racine)"}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadObjects(currentPrefix)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Rafraîchir
                        </button>
                        <label
                          className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              void handleUpload(file);
                              e.target.value = "";
                            }}
                            disabled={uploading || objectsLoading || !accountId}
                          />
                          {uploading ? "Téléversement..." : "Téléverser"}
                        </label>
                        <button
                          type="button"
                          disabled={selectedKeys.length !== 1 || objectsLoading || !accountId}
                          onClick={handleDownload}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          {downloading ? "Téléchargement..." : "Télécharger"}
                        </button>
                        <button
                          type="button"
                          disabled={selectedKeys.length === 0 || deleting || objectsLoading || !accountId}
                          onClick={handleDelete}
                          className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800 dark:hover:text-rose-100"
                        >
                          {deleting ? "Suppression..." : "Supprimer"}
                        </button>
                      </div>
                    </div>

                    {objectsError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                        {objectsError}
                      </div>
                    )}
                    {downloadError && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                        {downloadError}
                      </div>
                    )}
                    {uploadError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                        {uploadError}
                      </div>
                    )}
                    {actionMessage && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                        {actionMessage}
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                        <thead className="bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-4 py-2 text-left">
                              <input
                                type="checkbox"
                                checked={objects.length > 0 && selectedKeys.length === objects.length}
                                onChange={(e) => setSelectedKeys(e.target.checked ? objects.map((obj) => obj.key) : [])}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                aria-label="Sélectionner tous les objets"
                              />
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Nom
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Taille
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Dernière modification
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Classe de stockage
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {objectsLoading && (
                            <tr>
                              <td colSpan={5} className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                                Chargement des objets...
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && objectRows.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                                Aucun objet dans ce préfixe.
                              </td>
                            </tr>
                          )}
                          {!objectsLoading &&
                            objectRows.map((row) => {
                              if (row.type === "prefix") {
                                return (
                                  <tr
                                    key={row.key}
                                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    onClick={() => setCurrentPrefix(row.key)}
                                  >
                                    <td className="px-4 py-2" />
                                    <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">📁 {row.name}</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                  </tr>
                                );
                              }
                              const isSelected = selectedKeys.includes(row.key);
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="px-4 py-2">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelection(row.key)}
                                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                      aria-label={`Sélectionner ${row.name}`}
                                    />
                                  </td>
                                  <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">{row.name}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{formatBytes(row.object.size)}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                                    {row.object.last_modified ? new Date(row.object.last_modified).toLocaleString() : "—"}
                                  </td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{row.object.storage_class ?? "—"}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
