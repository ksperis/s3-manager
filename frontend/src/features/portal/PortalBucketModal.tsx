/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { S3AccountSelector } from "../../api/accountParams";
import { Bucket } from "../../api/buckets";
import { listObjects, S3Object } from "../../api/objects";
import Modal from "../../components/Modal";
import PageTabs from "../../components/PageTabs";
import SplitView from "../../components/SplitView";
import UsageTile from "../../components/UsageTile";
import { useI18n } from "../../i18n";
import { formatBytes, formatCompactNumber, formatPercentage } from "../../utils/format";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

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
  const { t } = useI18n();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
  const [activeTab, setActiveTab] = useState<"overview" | "objects">("overview");
  const [currentPrefix, setCurrentPrefix] = useState<string>("");
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [objectsError, setObjectsError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPrefix("");
    setObjects([]);
    setPrefixes([]);
    setObjectsError(null);
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
        setObjectsError(
          t({
            en: "Select an account to browse this bucket.",
            fr: "Selectionnez un compte pour explorer le bucket.",
            de: "Wahlen Sie ein Konto, um diesen Bucket zu durchsuchen.",
          })
        );
        return;
      }
      setObjectsLoading(true);
      setObjectsError(null);
      try {
        const data = await listObjects(accountId, bucket.name, prefix);
        setObjects(data.objects);
        setPrefixes(data.prefixes);
      } catch (err) {
        console.error(err);
        setObjects([]);
        setPrefixes([]);
        setObjectsError(
          t({
            en: "Unable to list bucket objects.",
            fr: "Impossible de lister les objets du bucket.",
            de: "Bucket-Objekte konnen nicht aufgelistet werden.",
          })
        );
      } finally {
        setObjectsLoading(false);
      }
    },
    [accountId, bucket.name, t]
  );

  useEffect(() => {
    if (activeTab !== "objects") return;
    loadObjects(currentPrefix);
  }, [activeTab, currentPrefix, loadObjects]);

  const storageShare = computeRelativeShare(bucket.used_bytes, accountUsedBytes);
  const objectsShare = computeRelativeShare(bucket.object_count, accountUsedObjects);
  const canOpenInBrowser =
    Boolean(accountId) && generalSettings.browser_enabled && generalSettings.browser_portal_enabled;

  const handleOpenInBrowser = () => {
    if (!accountId || !generalSettings.browser_enabled || !generalSettings.browser_portal_enabled) return;
    localStorage.setItem("selectedPortalAccountId", String(accountId));
    navigate(`/portal/browser?bucket=${encodeURIComponent(bucket.name)}`);
  };

  return (
    <Modal title={`Bucket ${bucket.name}`} onClose={onClose} maxWidthClass="max-w-6xl">
      <PageTabs
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as "overview" | "objects")}
        tabs={[
          {
            id: "overview",
            label: t({ en: "Overview", fr: "General", de: "Ubersicht" }),
            content: (
              <div className="space-y-4">
                <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="ui-caption font-semibold uppercase tracking-wide text-primary">
                        {t({ en: "Summary", fr: "Resume", de: "Zusammenfassung" })}
                      </p>
                      <h3 className="ui-title font-semibold text-slate-900 dark:text-slate-100">Bucket {bucket.name}</h3>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {t({ en: "Created on", fr: "Cree le", de: "Erstellt am" })}{" "}
                        {bucket.creation_date ? new Date(bucket.creation_date).toLocaleString() : "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenInBrowser}
                      disabled={!canOpenInBrowser}
                      className={`inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 ui-caption font-semibold text-slate-700 shadow-sm transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${
                        canOpenInBrowser
                          ? "hover:border-primary/60 hover:text-primary-700 dark:hover:text-primary-200"
                          : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      {t({ en: "Open in Browser", fr: "Ouvrir dans Browser", de: "Im Browser offnen" })}
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <UsageTile
                      label={t({ en: "Storage", fr: "Stockage", de: "Speicher" })}
                      used={bucket.used_bytes ?? null}
                      quota={bucket.quota_max_size_bytes ?? null}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      emptyHint={t({ en: "No quota defined for this bucket.", fr: "Aucun quota defini pour ce bucket.", de: "Kein Kontingent fur diesen Bucket definiert." })}
                    />
                    <UsageTile
                      label={t({ en: "Objects", fr: "Objets", de: "Objekte" })}
                      used={bucket.object_count ?? null}
                      quota={bucket.quota_max_objects ?? null}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                      unitHint={t({ en: "objects", fr: "objets", de: "Objekte" })}
                      emptyHint={t({ en: "No object quota defined.", fr: "Aucun quota d'objets defini.", de: "Kein Objektkontingent definiert." })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className={bucketCardClasses}>
                      <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {t({ en: "Account storage share", fr: "Part volumetrie compte", de: "Konto-Speicheranteil" })}
                      </p>
                      <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{storageShare != null ? formatPercentage(storageShare) : "—"}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {t({ en: "Based on total account usage.", fr: "Base sur l'usage global du compte.", de: "Basierend auf der gesamten Kontonutzung." })}
                      </p>
                    </div>
                    <div className={bucketCardClasses}>
                      <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {t({ en: "Account object share", fr: "Part objets compte", de: "Konto-Objektanteil" })}
                      </p>
                      <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">{objectsShare != null ? formatPercentage(objectsShare) : "—"}</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {t({ en: "Object count vs account total.", fr: "Nombre d'objets vs. total compte.", de: "Objektanzahl im Vergleich zum Kontogesamtwert." })}
                      </p>
                    </div>
                    <div className={bucketCardClasses}>
                      <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {t({ en: "Detected quota", fr: "Quota detecte", de: "Erkanntes Kontingent" })}
                      </p>
                      <p className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                        {bucket.quota_max_size_bytes
                          ? formatBytes(bucket.quota_max_size_bytes)
                          : t({ en: "Not defined", fr: "Non defini", de: "Nicht definiert" })}
                      </p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        {t({ en: "Allowed storage for this bucket.", fr: "Stockage autorise pour ce bucket.", de: "Zulassiger Speicher fur diesen Bucket." })}
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            ),
          },
          {
            id: "objects",
            label: t({ en: "Browse", fr: "Parcourir", de: "Durchsuchen" }),
            content: (
              <SplitView
                left={
                  <div className="p-3 space-y-2">
                    <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                      {t({ en: "Prefixes", fr: "Prefixes", de: "Prafixe" })}
                    </p>
                    <div className="space-y-1">
                      <button
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body ${
                          currentPrefix === ""
                            ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => setCurrentPrefix("")}
                      >
                        <span>{t({ en: "(root)", fr: "(racine)", de: "(wurzel)" })}</span>
                      </button>
                      {parentPrefix !== "" && (
                        <button
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                          onClick={() => setCurrentPrefix(parentPrefix)}
                        >
                          <span>{t({ en: "Up", fr: "Remonter", de: "Nach oben" })}</span>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">{parentPrefix || "/"}</span>
                        </button>
                      )}
                      {prefixes.map((prefix) => {
                        const isActive = prefix === currentPrefix;
                        const displayName = prefix.replace(currentPrefix, "") || prefix;
                        return (
                          <button
                            key={prefix}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body ${
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
                        <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">
                          {t({ en: "Current path", fr: "Chemin actuel", de: "Aktueller Pfad" })}
                        </p>
                        <div className="ui-caption text-slate-500 dark:text-slate-300">
                          {bucket.name}/{currentPrefix || t({ en: "(root)", fr: "(racine)", de: "(wurzel)" })}
                        </div>
                        <div className="ui-caption text-slate-500 dark:text-slate-400">
                          {t({
                            en: "Read-only preview. Use the main Browser page for object operations.",
                            fr: "Apercu en lecture seule. Utilisez la page Browser principale pour les operations.",
                            de: "Schreibgeschutzte Vorschau. Verwenden Sie fur Operationen die Hauptseite Browser.",
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadObjects(currentPrefix)}
                          className="rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          {t({ en: "Refresh", fr: "Rafraichir", de: "Aktualisieren" })}
                        </button>
                      </div>
                    </div>

                    {objectsError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                        {objectsError}
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                        <thead className="bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {t({ en: "Name", fr: "Nom", de: "Name" })}
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {t({ en: "Size", fr: "Taille", de: "Grosse" })}
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {t({ en: "Last modified", fr: "Derniere modification", de: "Zuletzt geandert" })}
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              {t({ en: "Storage class", fr: "Classe de stockage", de: "Speicherklasse" })}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {objectsLoading && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                {t({ en: "Loading objects...", fr: "Chargement des objets...", de: "Objekte werden geladen..." })}
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && objectRows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                {t({ en: "No object in this prefix.", fr: "Aucun objet dans ce prefixe.", de: "Keine Objekte in diesem Prafix." })}
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
                                    <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">📁 {row.name}</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                  </tr>
                                );
                              }
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
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
