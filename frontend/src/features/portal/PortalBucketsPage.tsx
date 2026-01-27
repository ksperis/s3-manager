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
import { usePortalAccountContext } from "./PortalAccountContext";

const MAX_BUCKET_NAME_LENGTH = 63;

type SortState = {
  field: keyof Bucket;
  direction: "asc" | "desc";
};

const bucketTableColumns: { label: string; field?: keyof Bucket | null; align?: "left" | "right" }[] = [
  { label: "Name", field: "name" },
  { label: "Used", field: "used_bytes" },
  { label: "Objects", field: "object_count" },
  { label: "Created on", field: null },
  { label: "Actions", field: null, align: "right" },
];

function normalizeBucketName(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return "";
  const sanitized = lower.replace(/[^a-z0-9.-]+/g, "-");
  const labels = sanitized
    .split(".")
    .map((label) => label.replace(/^-+/, "").replace(/-+$/, ""))
    .filter(Boolean);
  const joined = labels.join(".");
  return joined.replace(/^[.-]+/, "").replace(/[.-]+$/, "").slice(0, MAX_BUCKET_NAME_LENGTH);
}

function normalizeBucketInput(value: string): string {
  const lower = value.toLowerCase();
  if (!lower) return "";
  return lower.replace(/[^a-z0-9.-]+/g, "-").slice(0, MAX_BUCKET_NAME_LENGTH);
}

function isValidBucketName(value: string): boolean {
  if (value.length < 3 || value.length > MAX_BUCKET_NAME_LENGTH) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value)) return false;
  if (value.includes("..")) return false;
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  if (value.split(".").some((label) => !labelPattern.test(label))) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return true;
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

export default function PortalBucketsPage() {
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
  const accountName = selectedAccount?.name ?? "compte sélectionné";

  const canManageBuckets =
    Boolean(portalState?.can_manage_buckets) || portalState?.account_role === "portal_manager";

  const extractError = (err: unknown): string => {
    if (axios.isAxiosError(err)) {
      return ((err.response?.data as { detail?: string })?.detail || err.message || "Unexpected error");
    }
    return err instanceof Error ? err.message : "Unexpected error";
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
      setError("Impossible de charger les buckets du portail.");
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, canManageBuckets, filter]);

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
        setStateError("Impossible de charger le contexte portail.");
      })
      .finally(() => setStateLoading(false));
  }, [accountIdForApi]);

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
        const eligibleUsers = users.filter((user) => !user.iam_only && user.id != null);
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
    const normalized = normalizeBucketName(newBucketName);
    if (!normalized) {
      setActionError("Le nom du bucket est requis.");
      return;
    }
    if (!isValidBucketName(normalized)) {
      setActionError("Nom invalide. 3-63 caractères, minuscules, chiffres, points ou tirets.");
      return;
    }
    setCreating(true);
    setActionError(null);
    setActionMessage(null);
    try {
      await createPortalBucket(accountIdForApi, normalized);
      setActionMessage("Bucket créé.");
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
    const confirmed = confirmAction(`Supprimer le bucket '${bucketName}' et tous ses objets ?`);
    if (!confirmed) return;
    setDeletingBucket(bucketName);
    setActionError(null);
    setActionMessage(null);
    try {
      await deletePortalBucket(accountIdForApi, bucketName, true);
      setActionMessage("Bucket supprimé.");
      await fetchBuckets();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDeletingBucket(null);
    }
  };

  const isBucketNameValid = !newBucketName || isValidBucketName(newBucketName);
  const userBlocked = !accountLoading && !accountError && hasAccountContext && !stateLoading && !canManageBuckets;
  const showTable = hasAccountContext && (canManageBuckets || stateLoading);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Buckets"
        description={`Inventaire des buckets pour ${accountName}.`}
        breadcrumbs={[{ label: "Portal" }, { label: "Buckets" }]}
      />

      {stateError && <PageBanner tone="error">{stateError}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {actionError && <PageBanner tone="error">{actionError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}

      {!hasAccountContext && (
        <PageBanner tone="warning">Sélectionnez un compte avant d'afficher les buckets.</PageBanner>
      )}

      {userBlocked && (
        <PageBanner tone="warning">Cette page est réservée aux portal managers.</PageBanner>
      )}

      {showTable ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Buckets</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">Liste filtrable (portal manager).</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="ui-caption text-slate-500 dark:text-slate-400">{buckets.length} bucket(s)</span>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filtre</span>
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64 md:w-72"
                  disabled={!canManageBuckets}
                />
              </div>
              {canManageBuckets ? (
                <form onSubmit={handleCreateBucket} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(normalizeBucketInput(e.target.value))}
                    maxLength={MAX_BUCKET_NAME_LENGTH}
                    title={
                      isBucketNameValid
                        ? undefined
                        : "Nom invalide. 3-63 caractères, minuscules, chiffres, points ou tirets."
                    }
                    className={`w-full rounded-md border px-3 py-2 ui-body focus:outline-none focus:ring-2 sm:w-56 md:w-64 ${
                      isBucketNameValid
                        ? "border-slate-200 focus:border-primary focus:ring-primary/30 dark:border-slate-700"
                        : "border-rose-400 text-rose-700 focus:border-rose-500 focus:ring-rose-200 dark:border-rose-500 dark:text-rose-200 dark:focus:ring-rose-900/50"
                    } dark:bg-slate-900 dark:text-slate-100`}
                    placeholder="nouveau-bucket"
                  />
                  <button
                    type="submit"
                    disabled={creating || !newBucketName.trim() || !isBucketNameValid}
                    className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                  >
                    {creating ? "Création..." : "Créer"}
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
                    align={col.align ?? (col.label === "Actions" ? "right" : "left")}
                    onSort={col.field ? (field) => toggleSort(field as keyof Bucket) : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading && <TableEmptyState colSpan={bucketTableColumns.length} message="Chargement des buckets..." />}
              {error && !loading && buckets.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="Impossible de charger les buckets." />
              )}
              {!loading && !error && buckets.length === 0 && (
                <TableEmptyState colSpan={bucketTableColumns.length} message="Aucun bucket trouvé." />
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
                          Gestion
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBucket(bucket.name)}
                          disabled={!canManageBuckets || deletingBucket === bucket.name}
                          className={tableDeleteActionClasses}
                        >
                          {deletingBucket === bucket.name ? "Suppression..." : "Supprimer"}
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
          title={`Gestion des accès - ${accessBucket.name}`}
          onClose={() => {
            setShowAccessModal(false);
            setAccessBucket(null);
          }}
        >
          {accessUsersError && <PageBanner tone="error">{accessUsersError}</PageBanner>}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Utilisateurs du portail</p>
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {accessAssignments.size} autorise(s)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filtre</span>
                <input
                  type="search"
                  value={accessFilter}
                  onChange={(e) => setAccessFilter(e.target.value)}
                  placeholder="Rechercher..."
                  className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">Email</th>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">IAM user</th>
                    <th className="px-3 py-2 text-left ui-caption font-semibold text-slate-600 dark:text-slate-300">Role</th>
                    <th className="px-3 py-2 text-right ui-caption font-semibold text-slate-600 dark:text-slate-300">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {accessUsersLoading && (
                    <TableEmptyState colSpan={4} message="Chargement des utilisateurs..." />
                  )}
                  {!accessUsersLoading && filteredAccessUsers.length === 0 && (
                    <TableEmptyState colSpan={4} message="Aucun utilisateur disponible." />
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
                            {user.role === "portal_manager" ? "Portal manager" : "Portal user"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {hasAccess ? (
                              <button
                                type="button"
                                onClick={() => handleRevokeAccess(user)}
                                className={tableDeleteActionClasses}
                                disabled={busy}
                              >
                                {busy ? "Retrait..." : "Retirer"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleGrantAccess(user)}
                                className={tableActionButtonClasses}
                                disabled={busy}
                              >
                                {busy ? "Ajout..." : "Ajouter"}
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
