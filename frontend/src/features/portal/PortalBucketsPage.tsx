/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bucket } from "../../api/buckets";
import {
  createPortalBucket,
  deletePortalBucket,
  fetchPortalState,
  fetchPortalBucketStats,
  grantPortalUserBucket,
  listPortalBuckets,
  listPortalBucketUsers,
  listPortalUsers,
  PortalState,
  PortalUserSummary,
  revokePortalUserBucket,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import Modal from "../../components/Modal";
import SortableHeader from "../../components/SortableHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import { confirmAction } from "../../utils/confirm";
import {
  S3_BUCKET_NAME_MAX_LENGTH as MAX_BUCKET_NAME_LENGTH,
  isValidS3BucketName,
  normalizeS3BucketName,
  normalizeS3BucketNameInput,
} from "../../utils/s3BucketName";
import { useI18n } from "../../i18n";
import { usePortalAccountContext } from "./PortalAccountContext";

type SortState = {
  field: keyof Bucket;
  direction: "asc" | "desc";
};

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

const hasPortalBucketRole = (role?: string | null) =>
  role === "portal_manager" || role === "portal_user";

export default function PortalBucketsPage() {
  const { t } = useI18n();
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } =
    usePortalAccountContext();
  const [portalState, setPortalState] = useState<PortalState | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ field: "name", direction: "asc" });
  const [creating, setCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [newBucketName, setNewBucketName] = useState("");
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [accessBucket, setAccessBucket] = useState<Bucket | null>(null);
  const [accessUsers, setAccessUsers] = useState<PortalUserSummary[]>([]);
  const [accessUsersLoading, setAccessUsersLoading] = useState(false);
  const [accessUsersError, setAccessUsersError] = useState<string | null>(null);
  const [accessAssignments, setAccessAssignments] = useState<Set<number>>(new Set());
  const [accessBusyUserId, setAccessBusyUserId] = useState<number | null>(null);
  const [accessFilter, setAccessFilter] = useState("");
  const bucketsRef = useRef<Bucket[]>([]);
  const bucketStatsLoadedRef = useRef<Set<string>>(new Set());
  const [bucketStatsLoading, setBucketStatsLoading] = useState<Record<string, boolean>>({});
  const accountName = selectedAccount?.name ?? t({ en: "selected account", fr: "compte selectionne", de: "ausgewahltes Konto" });
  const bucketTableColumns: { label: string; field?: keyof Bucket | null; align?: "left" | "right" }[] = [
    { label: t({ en: "Name", fr: "Nom", de: "Name" }), field: "name" },
    { label: t({ en: "Used", fr: "Utilise", de: "Verwendet" }), field: "used_bytes" },
    { label: t({ en: "Objects", fr: "Objets", de: "Objekte" }), field: "object_count" },
    { label: t({ en: "Created on", fr: "Cree le", de: "Erstellt am" }), field: null },
    { label: t({ en: "Actions", fr: "Actions", de: "Aktionen" }), field: null, align: "right" },
  ];

  const canManageBuckets =
    Boolean(portalState?.can_manage_buckets) || portalState?.account_role === "portal_manager";

  const extractError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      return (
        (err.response?.data as { detail?: string })?.detail ||
        err.message ||
        t({ en: "Unexpected error", fr: "Erreur inattendue", de: "Unerwarteter Fehler" })
      );
    }
    return err instanceof Error ? err.message : t({ en: "Unexpected error", fr: "Erreur inattendue", de: "Unerwarteter Fehler" });
  };

  const fetchBuckets = useCallback(async () => {
    if (!accountIdForApi || !canManageBuckets) {
      setBuckets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await listPortalBuckets(accountIdForApi, {
        search: filter.trim() || undefined,
      });
      setBuckets(data);
    } catch (err) {
      console.error(err);
      setError(t({ en: "Unable to load portal buckets.", fr: "Impossible de charger les buckets du portail.", de: "Portal-Buckets konnen nicht geladen werden." }));
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, canManageBuckets, filter, t]);

  const loadBucketStats = useCallback(
    async (bucketName: string) => {
      if (!accountIdForApi || !canManageBuckets || !bucketName) return;
      if (bucketStatsLoadedRef.current.has(bucketName)) return;
      const existing = bucketsRef.current.find((b) => b.name === bucketName);
      if (existing && (existing.used_bytes != null || existing.object_count != null)) {
        bucketStatsLoadedRef.current.add(bucketName);
        return;
      }
      setBucketStatsLoading((prev) => (prev[bucketName] ? prev : { ...prev, [bucketName]: true }));
      try {
        const stats = await fetchPortalBucketStats(accountIdForApi, bucketName);
        bucketStatsLoadedRef.current.add(bucketName);
        setBuckets((prev) =>
          prev.map((bucket) =>
            bucket.name === bucketName
              ? { ...bucket, used_bytes: stats.used_bytes ?? null, object_count: stats.object_count ?? null }
              : bucket
          )
        );
      } catch (err) {
        console.error(err);
        bucketStatsLoadedRef.current.add(bucketName);
      } finally {
        setBucketStatsLoading((prev) => {
          if (!prev[bucketName]) return prev;
          const next = { ...prev };
          delete next[bucketName];
          return next;
        });
      }
    },
    [accountIdForApi, canManageBuckets]
  );

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalState(null);
      setStateError(null);
      setStateLoading(false);
      return;
    }
    setStateLoading(true);
    setStateError(null);
    fetchPortalState(accountIdForApi)
      .then((data) => {
        setPortalState(data);
      })
      .catch((err) => {
        console.error(err);
        setPortalState(null);
        setStateError(t({ en: "Unable to load portal context.", fr: "Impossible de charger le contexte portail.", de: "Portal-Kontext kann nicht geladen werden." }));
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi, t]);

  useEffect(() => {
    setActionError(null);
    setActionMessage(null);
  }, [accountIdForApi, filter]);

  useEffect(() => {
    if (!showAccessModal) {
      setAccessUsers([]);
      setAccessUsersError(null);
      setAccessUsersLoading(false);
      setAccessAssignments(new Set());
      setAccessBusyUserId(null);
      setAccessFilter("");
    }
  }, [showAccessModal]);

  useEffect(() => {
    if (!hasAccountContext) {
      setBuckets([]);
      setLoading(false);
      return;
    }
    fetchBuckets();
  }, [fetchBuckets, hasAccountContext]);

  useEffect(() => {
    bucketsRef.current = buckets;
  }, [buckets]);

  const sortedBuckets = useMemo(() => {
    const sorted = [...buckets].sort((a, b) => {
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
  }, [buckets, sort]);

  const toggleSort = (field: keyof Bucket) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
  };

  const bucketNamesKey = useMemo(() => buckets.map((bucket) => bucket.name).join("|"), [buckets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!buckets.length || !canManageBuckets) return;
    if (!("IntersectionObserver" in window)) {
      buckets.forEach((bucket) => {
        void loadBucketStats(bucket.name);
      });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const name = (entry.target as HTMLElement).dataset.portalBucket;
          if (name) {
            void loadBucketStats(name);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "200px" }
    );
    const nodes = document.querySelectorAll("[data-portal-bucket-row]");
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [bucketNamesKey, buckets, canManageBuckets, loadBucketStats]);

  const filteredAccessUsers = useMemo(() => {
    const query = accessFilter.trim().toLowerCase();
    const filtered = query
      ? accessUsers.filter((user) => {
          const email = user.email.toLowerCase();
          const iam = (user.iam_username ?? "").toLowerCase();
          return email.includes(query) || iam.includes(query);
        })
      : accessUsers;
    return [...filtered].sort((a, b) => {
      const aAssigned = a.id != null && accessAssignments.has(a.id);
      const bAssigned = b.id != null && accessAssignments.has(b.id);
      if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
      return a.email.localeCompare(b.email);
    });
  }, [accessFilter, accessAssignments, accessUsers]);

  const openAccessModal = useCallback(
    async (bucket: Bucket) => {
      if (!accountIdForApi || !canManageBuckets) return;
      setAccessBucket(bucket);
      setShowAccessModal(true);
      setAccessUsersLoading(true);
      setAccessUsersError(null);
      try {
        const [users, bucketUsers] = await Promise.all([
          listPortalUsers(accountIdForApi),
          listPortalBucketUsers(accountIdForApi, bucket.name),
        ]);
        const eligibleUsers = users.filter(
          (user) => !user.iam_only && user.id != null && hasPortalBucketRole(user.role)
        );
        const assigned = new Set(
          bucketUsers
            .map((user) => user.id)
            .filter((id): id is number => typeof id === "number")
        );
        setAccessUsers(eligibleUsers);
        setAccessAssignments(assigned);
      } catch (err) {
        setAccessUsersError(extractError(err));
        setAccessUsers([]);
        setAccessAssignments(new Set());
      } finally {
        setAccessUsersLoading(false);
      }
    },
    [accountIdForApi, canManageBuckets]
  );

  const handleGrantAccess = async (user: PortalUserSummary) => {
    if (!accountIdForApi || !accessBucket || !canManageBuckets || !user.id) return;
    setAccessBusyUserId(user.id);
    setAccessUsersError(null);
    try {
      await grantPortalUserBucket(accountIdForApi, user.id, accessBucket.name);
      setAccessAssignments((prev) => {
        const next = new Set(prev);
        next.add(user.id as number);
        return next;
      });
    } catch (err) {
      setAccessUsersError(extractError(err));
    } finally {
      setAccessBusyUserId(null);
    }
  };

  const handleRevokeAccess = async (user: PortalUserSummary) => {
    if (!accountIdForApi || !accessBucket || !canManageBuckets || !user.id) return;
    setAccessBusyUserId(user.id);
    setAccessUsersError(null);
    try {
      await revokePortalUserBucket(accountIdForApi, user.id, accessBucket.name);
      setAccessAssignments((prev) => {
        const next = new Set(prev);
        next.delete(user.id as number);
        return next;
      });
    } catch (err) {
      setAccessUsersError(extractError(err));
    } finally {
      setAccessBusyUserId(null);
    }
  };

  const handleCreateBucket = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi || !canManageBuckets) return;
    const normalized = normalizeS3BucketName(newBucketName);
    if (!normalized) {
      setActionError(t({ en: "Bucket name is required.", fr: "Le nom du bucket est requis.", de: "Bucket-Name ist erforderlich." }));
      return;
    }
    if (!isValidS3BucketName(normalized)) {
      setActionError(t({ en: "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.", fr: "Nom invalide. 3-63 caracteres, minuscules, chiffres, points ou tirets.", de: "Ungueltiger Name. 3-63 Zeichen, Kleinbuchstaben, Zahlen, Punkte oder Bindestriche." }));
      return;
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createPortalBucket(accountIdForApi, normalized);
      setActionMessage(t({ en: "Bucket created.", fr: "Bucket cree.", de: "Bucket erstellt." }));
      setNewBucketName("");
      await fetchBuckets();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBucket = async (bucketName: string) => {
    if (!accountIdForApi || !canManageBuckets) return;
    const confirmed = confirmAction(
      t({
        en: `Delete bucket '${bucketName}' and all its objects?`,
        fr: `Supprimer le bucket '${bucketName}' et tous ses objets ?`,
        de: `Bucket '${bucketName}' und alle Objekte loschen?`,
      })
    );
    if (!confirmed) return;
    setDeletingBucket(bucketName);
    setActionError(null);
    setActionMessage(null);
    try {
      await deletePortalBucket(accountIdForApi, bucketName, true);
      setActionMessage(t({ en: "Bucket deleted.", fr: "Bucket supprime.", de: "Bucket geloescht." }));
      await fetchBuckets();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDeletingBucket(null);
    }
  };

  const isBucketNameValid = !newBucketName || isValidS3BucketName(newBucketName);
  const userBlocked = !accountLoading && !accountError && hasAccountContext && !stateLoading && !canManageBuckets;
  const showTable = hasAccountContext && (canManageBuckets || stateLoading);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Buckets", fr: "Buckets", de: "Buckets" })}
        description={t({ en: `Bucket inventory for ${accountName}.`, fr: `Inventaire des buckets pour ${accountName}.`, de: `Bucket-Inventar fur ${accountName}.` })}
        breadcrumbs={[
          { label: t({ en: "Portal", fr: "Portail", de: "Portal" }) },
          { label: t({ en: "Buckets", fr: "Buckets", de: "Buckets" }) },
        ]}
      />

      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {!hasAccountContext && (
        <PageBanner tone="warning">{t({ en: "Select an account before displaying buckets.", fr: "Selectionnez un compte avant d'afficher les buckets.", de: "Wahlen Sie ein Konto, bevor Sie Buckets anzeigen." })}</PageBanner>
      )}

      {userBlocked && (
        <PageBanner tone="warning">{t({ en: "This page is reserved for portal managers.", fr: "Cette page est reservee aux portal managers.", de: "Diese Seite ist nur fur Portal-Manager vorgesehen." })}</PageBanner>
      )}

      {showTable ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">{t({ en: "Buckets", fr: "Buckets", de: "Buckets" })}</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{t({ en: "Filterable list (portal manager).", fr: "Liste filtrable (portal manager).", de: "Filterbare Liste (Portal-Manager)." })}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="ui-caption text-slate-500 dark:text-slate-400">
                {t({
                  en: `${buckets.length} bucket(s)`,
                  fr: `${buckets.length} bucket(s)`,
                  de: `${buckets.length} Bucket(s)`,
                })}
              </span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t({ en: "Filter", fr: "Filtre", de: "Filter" })}</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t({ en: "Search...", fr: "Rechercher...", de: "Suchen..." })}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                  disabled={!canManageBuckets}
                />
              </div>
              {canManageBuckets ? (
                <form onSubmit={handleCreateBucket} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(normalizeS3BucketNameInput(e.target.value))}
                    maxLength={MAX_BUCKET_NAME_LENGTH}
                    title={
                      isBucketNameValid
                        ? undefined
                        : t({ en: "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.", fr: "Nom invalide. 3-63 caracteres, minuscules, chiffres, points ou tirets.", de: "Ungueltiger Name. 3-63 Zeichen, Kleinbuchstaben, Zahlen, Punkte oder Bindestriche." })
                    }
                    className={`w-full rounded-md border px-3 py-2 ui-body focus:outline-none focus:ring-2 sm:w-56 md:w-64 ${
                      isBucketNameValid
                        ? "border-slate-200 focus:border-primary focus:ring-primary/30 dark:border-slate-700"
                        : "border-rose-400 text-rose-700 focus:border-rose-500 focus:ring-rose-200 dark:border-rose-500 dark:text-rose-200 dark:focus:ring-rose-900/50"
                    } dark:bg-slate-900 dark:text-slate-100`}
                    placeholder={t({ en: "new-bucket", fr: "nouveau-bucket", de: "neuer-bucket" })}
                  />
                  <button
                    type="submit"
                    disabled={creating || !newBucketName.trim() || !isBucketNameValid}
                    className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                  >
                    {creating
                      ? t({ en: "Creating...", fr: "Creation...", de: "Erstellung..." })
                      : t({ en: "Create", fr: "Creer", de: "Erstellen" })}
                  </button>
                </form>
              ) : null}
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
                    align={col.align ?? (col.label === t({ en: "Actions", fr: "Actions", de: "Aktionen" }) ? "right" : "left")}
                    onSort={col.field ? (field) => toggleSort(field as keyof Bucket) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && (
                <TableEmptyState
                  colSpan={bucketTableColumns.length}
                  message={t({ en: "Loading buckets...", fr: "Chargement des buckets...", de: "Buckets werden geladen..." })}
                />
              )}
              {error && !loading && buckets.length === 0 && (
                <TableEmptyState
                  colSpan={bucketTableColumns.length}
                  message={t({ en: "Unable to load buckets.", fr: "Impossible de charger les buckets.", de: "Buckets konnen nicht geladen werden." })}
                />
              )}
              {!loading && !error && buckets.length === 0 && (
                <TableEmptyState
                  colSpan={bucketTableColumns.length}
                  message={t({ en: "No bucket found.", fr: "Aucun bucket trouve.", de: "Kein Bucket gefunden." })}
                />
              )}
              {!loading &&
                !error &&
                sortedBuckets.map((bucket) => (
                  <tr
                    key={bucket.name}
                    data-portal-bucket-row
                    data-portal-bucket={bucket.name}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-3 py-2 ui-body font-semibold text-slate-900 dark:text-slate-100">
                      {bucket.name}
                    </td>
                    <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                      {bucketStatsLoading[bucket.name] && bucket.used_bytes == null ? "…" : formatBytes(bucket.used_bytes)}
                    </td>
                    <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                      {bucketStatsLoading[bucket.name] && bucket.object_count == null
                        ? "…"
                        : formatNumber(bucket.object_count)}
                    </td>
                    <td className="px-3 py-2 ui-body text-slate-700 dark:text-slate-200">
                      {bucket.creation_date ? new Date(bucket.creation_date).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openAccessModal(bucket)}
                          disabled={!canManageBuckets}
                          className={tableActionButtonClasses}
                        >
                          {t({ en: "Manage", fr: "Gestion", de: "Verwalten" })}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBucket(bucket.name)}
                          disabled={!canManageBuckets || deletingBucket === bucket.name}
                          className={tableDeleteActionClasses}
                        >
                          {deletingBucket === bucket.name
                            ? t({ en: "Deleting...", fr: "Suppression...", de: "Wird geloscht..." })
                            : t({ en: "Delete", fr: "Supprimer", de: "Loschen" })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      ) : null}

      {showAccessModal && accessBucket && (
        <Modal
          title={t({
            en: `Access management - ${accessBucket.name}`,
            fr: `Gestion des acces - ${accessBucket.name}`,
            de: `Zugriffsverwaltung - ${accessBucket.name}`,
          })}
          onClose={() => {
            setShowAccessModal(false);
            setAccessBucket(null);
          }}
        >
          {accessUsersError && <PageBanner tone="error">{accessUsersError}</PageBanner>}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">
                  {t({ en: "Portal users", fr: "Utilisateurs du portail", de: "Portal-Benutzer" })}
                </p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {t({
                    en: `${accessAssignments.size} authorized`,
                    fr: `${accessAssignments.size} autorise(s)`,
                    de: `${accessAssignments.size} autorisiert`,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t({ en: "Filter", fr: "Filtre", de: "Filter" })}</span>
                <input
                  type="search"
                  value={accessFilter}
                  onChange={(e) => setAccessFilter(e.target.value)}
                  placeholder={t({ en: "Search...", fr: "Rechercher...", de: "Suchen..." })}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Email", fr: "Email", de: "E-Mail" })}</th>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">{t({ en: "IAM user", fr: "Utilisateur IAM", de: "IAM-Benutzer" })}</th>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Role", fr: "Role", de: "Rolle" })}</th>
                    <th className="px-3 py-2 text-right ui-caption font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Action", fr: "Action", de: "Aktion" })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {accessUsersLoading && (
                    <TableEmptyState
                      colSpan={4}
                      message={t({ en: "Loading users...", fr: "Chargement des utilisateurs...", de: "Benutzer werden geladen..." })}
                    />
                  )}
                  {!accessUsersLoading && filteredAccessUsers.length === 0 && (
                    <TableEmptyState
                      colSpan={4}
                      message={t({ en: "No user available.", fr: "Aucun utilisateur disponible.", de: "Kein Benutzer verfugbar." })}
                    />
                  )}
                  {!accessUsersLoading &&
                    filteredAccessUsers.map((user) => {
                      const userId = user.id ?? null;
                      const hasAccess = userId != null && accessAssignments.has(userId);
                      const busy = accessBusyUserId === userId;
                      return (
                        <tr key={userId ?? user.email} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2 ui-body font-semibold text-slate-900 dark:text-slate-100">
                            {user.email}
                          </td>
                          <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">
                            <span className="font-mono">{user.iam_username || "-"}</span>
                          </td>
                          <td className="px-3 py-2 ui-body text-slate-600 dark:text-slate-300">
                            {user.role === "portal_manager"
                              ? t({ en: "Portal manager", fr: "Portal manager", de: "Portal-Manager" })
                              : user.role === "portal_user"
                                ? t({ en: "Portal user", fr: "Portal user", de: "Portal-Benutzer" })
                                : user.role === "portal_none"
                                  ? t({ en: "No portal access", fr: "Pas d'acces portail", de: "Kein Portalzugriff" })
                                  : t({ en: "Unknown role", fr: "Role inconnu", de: "Unbekannte Rolle" })}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {hasAccess ? (
                              <button
                                type="button"
                                onClick={() => handleRevokeAccess(user)}
                                className={tableDeleteActionClasses}
                                disabled={busy}
                              >
                                {busy
                                  ? t({ en: "Removing...", fr: "Retrait...", de: "Wird entfernt..." })
                                  : t({ en: "Remove", fr: "Retirer", de: "Entfernen" })}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleGrantAccess(user)}
                                className={tableActionButtonClasses}
                                disabled={busy}
                              >
                                {busy
                                  ? t({ en: "Adding...", fr: "Ajout...", de: "Wird hinzugefugt..." })
                                  : t({ en: "Add", fr: "Ajouter", de: "Hinzufugen" })}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
