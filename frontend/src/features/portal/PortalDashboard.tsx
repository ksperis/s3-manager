/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bucket } from "../../api/buckets";
import {
  createPortalAccessKey,
  createPortalBucket,
  deletePortalAccessKey,
  fetchPortalState,
  PortalAccessKey,
  PortalAccountRole,
  PortalState,
  PortalUserSummary,
  listPortalUsers,
  addPortalUser,
  updatePortalUserRole,
  deletePortalUser,
  listPortalUserBuckets,
  grantPortalUserBucket,
  revokePortalUserBucket,
  updatePortalAccessKeyStatus,
  rotatePortalAccessKey,
  fetchPortalActiveKey,
  fetchPortalPublicSettings,
  fetchPortalTraffic,
  fetchPortalBucketStats,
  fetchPortalUsage,
} from "../../api/portal";
import { usePortalAccountContext } from "./PortalAccountContext";
import Modal from "../../components/Modal";
import PortalBucketModal from "./PortalBucketModal";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

function Badge({ label, tone = "slate" }: { label: string; tone?: "slate" | "sky" | "emerald" | "amber" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{label}</span>;
}

function CopyButton({ value, label, iconOnly = false }: { value: string; label: string; iconOnly?: boolean }) {
  const handleCopy = () => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  };
  const sizeClass = iconOnly ? "h-7 w-7 text-xs" : "gap-1 px-3 py-1 text-[11px]";
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full bg-slate-900 font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 ${sizeClass}`}
    >
      <span aria-hidden>📋</span>
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

export default function PortalDashboard() {
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [state, setState] = useState<PortalState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);
  const [lastCreatedKey, setLastCreatedKey] = useState<{ accessKey: string; secretKey: string } | null>(null);
  const [bucketActionError, setBucketActionError] = useState<string | null>(null);
  const [accountUsage, setAccountUsage] = useState<{ used_bytes: number | null; used_objects: number | null } | null>(null);
  const [accountUsageLoading, setAccountUsageLoading] = useState(false);
  const [accountUsageError, setAccountUsageError] = useState<string | null>(null);
  const bucketsRef = useRef<Bucket[]>([]);
  const bucketStatsLoadedRef = useRef<Set<string>>(new Set());
  const [bucketStatsLoading, setBucketStatsLoading] = useState<Record<string, boolean>>({});
  const [bucketFilter, setBucketFilter] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [togglingKeyId, setTogglingKeyId] = useState<string | null>(null);
  const [renewingPortalKey, setRenewingPortalKey] = useState(false);
  const [showPortalKeyDetails, setShowPortalKeyDetails] = useState(false);
  const [portalKeyData, setPortalKeyData] = useState<PortalAccessKey | null>(null);
  const [portalKeyLoading, setPortalKeyLoading] = useState(false);
  const [portalKeyError, setPortalKeyError] = useState<string | null>(null);
  const [creatingBucket, setCreatingBucket] = useState(false);
  const [showBucketModal, setShowBucketModal] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [newBucketName, setNewBucketName] = useState("");
  const [portalUsers, setPortalUsers] = useState<PortalUserSummary[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [userActionMessage, setUserActionMessage] = useState<string | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [focusedUserKey, setFocusedUserKey] = useState<string | null>(null);
  const [showEditPortalUserModal, setShowEditPortalUserModal] = useState(false);
  const [editPortalUser, setEditPortalUser] = useState<PortalUserSummary | null>(null);
  const [editPortalBuckets, setEditPortalBuckets] = useState<string[]>([]);
  const [editPortalSelectedBucket, setEditPortalSelectedBucket] = useState("");
  const [editPortalError, setEditPortalError] = useState<string | null>(null);
  const [editPortalMessage, setEditPortalMessage] = useState<string | null>(null);
  const [editPortalLoading, setEditPortalLoading] = useState(false);
  const [editPortalSaving, setEditPortalSaving] = useState(false);
  const [editPortalRemovingBucket, setEditPortalRemovingBucket] = useState<string | null>(null);
  const [portalSettings, setPortalSettings] = useState<{ allow_portal_key: boolean; allow_portal_user_bucket_create: boolean }>({
    allow_portal_key: false,
    allow_portal_user_bucket_create: false,
  });
  const [trafficSparkline, setTrafficSparkline] = useState<{ timestamp: number; total: number; ops: number }[]>([]);
  const [trafficOps24h, setTrafficOps24h] = useState(0);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const accountUsedBytes = accountUsage?.used_bytes ?? state?.used_bytes ?? null;
  const accountUsedObjects = accountUsage?.used_objects ?? state?.used_objects ?? null;
  const derivedBucketTotals = useMemo(() => {
    const buckets = state?.buckets ?? [];
    let bytesSum = 0;
    let objectsSum = 0;
    let hasBytes = false;
    let hasObjects = false;
    buckets.forEach((bucket) => {
      if (bucket.used_bytes != null) {
        bytesSum += bucket.used_bytes;
        hasBytes = true;
      }
      if (bucket.object_count != null) {
        objectsSum += bucket.object_count;
        hasObjects = true;
      }
    });
    return {
      bytes: hasBytes ? bytesSum : null,
      objects: hasObjects ? objectsSum : null,
    };
  }, [state?.buckets]);
  const bucketTotalsBytes = accountUsedBytes != null ? accountUsedBytes : derivedBucketTotals.bytes;
  const bucketTotalsObjects = accountUsedObjects != null ? accountUsedObjects : derivedBucketTotals.objects;
  const visibleBucketCount = state?.buckets?.length ?? 0;
  const totalBucketCount = state?.total_buckets ?? visibleBucketCount;
  const allAccessKeys = useMemo(() => state?.access_keys ?? [], [state?.access_keys]);
  const orderedAccessKeys = useMemo(() => {
    const portalKeys = allAccessKeys.filter((key) => key.is_portal);
    const userKeys = allAccessKeys.filter((key) => !key.is_portal);
    return [...portalKeys, ...userKeys];
  }, [allAccessKeys]);
  const filteredBuckets = useMemo(() => {
    const list = state?.buckets ?? [];
    const query = bucketFilter.trim().toLowerCase();
    if (!query) return list;
    return list.filter((bucket) => bucket.name.toLowerCase().includes(query));
  }, [state?.buckets, bucketFilter]);
  const bucketNamesKey = useMemo(
    () => filteredBuckets.map((bucket) => bucket.name).join("|"),
    [filteredBuckets]
  );

  const formatBytes = (value?: number | null) => {
    if (value == null) return "—";
    if (value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let idx = 0;
    let current = value;
    while (current >= 1024 && idx < units.length - 1) {
      current /= 1024;
      idx += 1;
    }
    return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[idx]}`;
  };

  const trafficTotal24h = useMemo(
    () => trafficSparkline.reduce((sum, point) => sum + point.total, 0),
    [trafficSparkline]
  );
  const hasTrafficSparkline = trafficSparkline.length > 0;

  const { userRole, userEmail } = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { role?: string | null; email?: string | null };
      return { userRole: parsed.role ?? null, userEmail: parsed.email ?? null };
    } catch {
      return null;
    }
  }, []);

  const isAccountAdmin = useMemo(() => Boolean(state?.can_manage_portal_users), [state?.can_manage_portal_users]);

  const canManageBuckets = Boolean(state?.can_manage_buckets);
  const allowPortalUserBucketCreate = Boolean(portalSettings.allow_portal_user_bucket_create && state?.account_role === "portal_user");
  const canCreateBuckets = canManageBuckets || allowPortalUserBucketCreate;
  const canManagePortalUsers = Boolean(state?.can_manage_portal_users || isAccountAdmin);
  const canViewPortalUsers = canManagePortalUsers;
  const assignedPortalUsers = useMemo(() => portalUsers.filter((u) => !u.iam_only), [portalUsers]);
  const iamOnlyUsers = useMemo(() => portalUsers.filter((u) => u.iam_only), [portalUsers]);
  const portalUsersCount = canViewPortalUsers ? assignedPortalUsers.length : "-";
  const clampRatio = (used?: number | null, quota?: number | null) => {
    if (used == null || quota == null || quota <= 0) return null;
    return Math.min(100, Math.max(0, (used / quota) * 100));
  };

  const computeRelativeShare = (used?: number | null, total?: number | null) => {
    if (used == null || total == null) return null;
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, (used / total) * 100));
  };

  const openBucketModal = (bucket: Bucket) => {
    setSelectedBucket(bucket);
    setShowBucketModal(true);
    void loadBucketStats(bucket.name);
  };

  const closeBucketModal = () => {
    setShowBucketModal(false);
    setSelectedBucket(null);
  };

  const isPortalKeyActive = (key?: PortalAccessKey | null): boolean => {
    if (!key) return false;
    if (key.is_active !== undefined && key.is_active !== null) return Boolean(key.is_active);
    if (key.status) {
      const normalized = key.status.toLowerCase();
      if (["inactive", "disabled"].includes(normalized)) return false;
      if (normalized === "active") return true;
    }
    return true;
  };

  const renderUsageGauge = ({
    label,
    used,
    quota,
    formatter,
    unitHint,
    percentOverride,
    bare = false,
    compact = false,
    hidePercent = false,
    size = "md",
  }: {
    label: string;
    used?: number | null;
    quota?: number | null;
    formatter: (value?: number | null) => string;
    unitHint?: string;
    percentOverride?: number | null;
    bare?: boolean;
    compact?: boolean;
    hidePercent?: boolean;
    size?: "sm" | "md" | "lg";
  }) => {
    const ratio = percentOverride ?? clampRatio(used, quota);
    const display = formatter(used);
    const quotaDisplay = quota !== undefined && quota !== null ? formatter(quota) : null;
    const percentLabel = ratio !== null ? `${Math.round(ratio)}%` : "N/A";
    const gradient =
      ratio === null
        ? undefined
        : `conic-gradient(var(--tw-color-primary, #0ea5e9) ${ratio}%, rgba(148,163,184,0.2) ${ratio}%)`;
    const sizeClasses = compact
      ? "h-11 w-11"
      : size === "lg"
      ? "h-16 w-16"
      : size === "sm"
      ? "h-12 w-12"
      : "h-14 w-14";
    const labelText = compact ? "text-[7px]" : size === "lg" ? "text-[10px]" : size === "sm" ? "text-[8px]" : "text-[9px]";
    const valueText = compact ? "text-[9px]" : size === "lg" ? "text-[12px]" : "text-[11px]";
    const widthClass = size === "lg" ? "min-w-[180px]" : size === "sm" ? "min-w-[120px]" : "min-w-[150px]";
    const wrapperClasses = bare
      ? "flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
      : `flex items-center gap-2 rounded-xl border border-slate-200 bg-white text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900/70 ${
          size === "lg" ? "px-4 py-3" : "px-3 py-2"
        } ${widthClass}`;
    return (
      <div className={wrapperClasses}>
        <div
          className={`relative ${sizeClasses} rounded-full bg-slate-100 dark:bg-slate-800`}
          style={gradient ? { backgroundImage: gradient } : undefined}
          aria-label={`${label} ${percentLabel}`}
        >
          <div className="absolute inset-1 rounded-full bg-white dark:bg-slate-900" />
          <div className="absolute inset-2 flex flex-col items-center justify-center text-center font-semibold text-slate-700 dark:text-slate-100">
            <span className={`${labelText} uppercase text-slate-500 dark:text-slate-400`}>{label}</span>
            {!hidePercent && <span className={valueText}>{percentLabel}</span>}
          </div>
        </div>
        {!bare && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100">
              <span>{display}</span>
              {unitHint ? <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{unitHint}</span> : null}
            </div>
            {quotaDisplay ? (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                / {quotaDisplay}
                {unitHint && unitHint !== "Sans quota" ? ` ${unitHint}` : ""}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Sans quota</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const loadBucketStats = useCallback(
    async (bucketName: string) => {
      if (!accountIdForApi || !bucketName) return;
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
        setState((prev) => {
          if (!prev) return prev;
          const buckets = (prev.buckets || []).map((b) =>
            b.name === bucketName
              ? { ...b, used_bytes: stats.used_bytes ?? null, object_count: stats.object_count ?? null }
              : b
          );
          return { ...prev, buckets };
        });
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
    [accountIdForApi]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!hasAccountContext || !accountIdForApi) {
        setState(null);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const data = await fetchPortalState(accountIdForApi);
        if (!cancelled) {
          setState(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError("Impossible de charger les informations du portail.");
          setState(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, hasAccountContext]);

  useEffect(() => {
    let cancelled = false;
    if (!accountIdForApi) {
      setAccountUsage(null);
      setAccountUsageLoading(false);
      setAccountUsageError(null);
      return () => {
        cancelled = true;
      };
    }
    setAccountUsage(null);
    setAccountUsageLoading(true);
    setAccountUsageError(null);
    fetchPortalUsage(accountIdForApi)
      .then((usage) => {
        if (cancelled) return;
        setAccountUsage({
          used_bytes: usage.used_bytes ?? null,
          used_objects: usage.used_objects ?? null,
        });
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setAccountUsage(null);
        setAccountUsageError("Usage du compte indisponible.");
      })
      .finally(() => {
        if (!cancelled) {
          setAccountUsageLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi]);

  useEffect(() => {
    bucketStatsLoadedRef.current.clear();
    setBucketStatsLoading({});
    setBucketFilter("");
  }, [accountIdForApi]);

  useEffect(() => {
    bucketsRef.current = state?.buckets ?? [];
  }, [state?.buckets]);

  useEffect(() => {
    let cancelled = false;
    const loadTrafficSparkline = async () => {
      if (!accountIdForApi) {
        if (!cancelled) {
          setTrafficSparkline([]);
          setTrafficOps24h(0);
          setTrafficLoading(false);
        }
        return;
      }
      setTrafficLoading(true);
      try {
        const stats = await fetchPortalTraffic(accountIdForApi, "day");
        if (cancelled) return;
        const points = (stats?.series ?? [])
          .map((point) => ({
            timestamp: new Date(point.timestamp).getTime(),
            total: point.bytes_in + point.bytes_out,
            ops: point.ops ?? 0,
          }))
          .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.total) && Number.isFinite(point.ops))
          .sort((a, b) => a.timestamp - b.timestamp);
        setTrafficSparkline(points);
        setTrafficOps24h(stats?.totals?.ops ?? points.reduce((sum, point) => sum + point.ops, 0));
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setTrafficSparkline([]);
          setTrafficOps24h(0);
        }
      } finally {
        if (!cancelled) {
          setTrafficLoading(false);
        }
      }
    };
    loadTrafficSparkline();
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi]);

  useEffect(() => {
    let cancelled = false;
    const loadUsers = async () => {
      if (!canViewPortalUsers || !accountIdForApi) {
        setPortalUsers([]);
        return;
      }
      try {
        setLoadingUsers(true);
        setUserActionError(null);
        const data = await listPortalUsers(accountIdForApi);
        if (!cancelled) {
          setPortalUsers(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setUserActionError("Impossible de charger les utilisateurs du portail.");
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    };
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, canViewPortalUsers]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!state?.buckets?.length) return;
    if (!("IntersectionObserver" in window)) {
      state.buckets.forEach((bucket) => {
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
    const nodes = document.querySelectorAll("[data-portal-bucket]");
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [bucketNamesKey, loadBucketStats]);

  useEffect(() => {
    if (!selectedBucket || !state?.buckets) return;
    const updated = state.buckets.find((b) => b.name === selectedBucket.name);
    if (!updated) {
      setSelectedBucket(null);
      setShowBucketModal(false);
      return;
    }
    if (
      updated.used_bytes !== selectedBucket.used_bytes ||
      updated.object_count !== selectedBucket.object_count ||
      updated.quota_max_size_bytes !== selectedBucket.quota_max_size_bytes ||
      updated.quota_max_objects !== selectedBucket.quota_max_objects ||
      updated.creation_date !== selectedBucket.creation_date
    ) {
      setSelectedBucket(updated);
    }
  }, [selectedBucket, state?.buckets]);

  const handleRotateKey = async () => {
    if (!accountIdForApi) return;
    setCreatingKey(true);
    setKeyActionError(null);
    setLastCreatedKey(null);
    try {
      const key = await createPortalAccessKey(accountIdForApi);
      if (key.secret_access_key) {
        setLastCreatedKey({
          accessKey: key.access_key_id,
          secretKey: key.secret_access_key,
        });
      }
      setState((prev) =>
        prev
          ? {
              ...prev,
              access_keys: [key, ...(prev.access_keys || [])],
            }
          : prev
      );
    } catch (err) {
      console.error(err);
      setKeyActionError("Impossible de créer une nouvelle clé. Vérifiez vos droits IAM.");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRenewPortalKey = async () => {
    if (!accountIdForApi) return;
    const previousPortalKey = state?.access_keys.find((k) => k.is_portal);
    setRenewingPortalKey(true);
    setKeyActionError(null);
    setLastCreatedKey(null);
    try {
      const key = await rotatePortalAccessKey(accountIdForApi);
      if (key.secret_access_key) {
        setLastCreatedKey({
          accessKey: key.access_key_id,
          secretKey: key.secret_access_key,
        });
      }
      setState((prev) => {
        if (!prev) return prev;
        const updatedKeys = (prev.access_keys || []).map((k) => {
          if (previousPortalKey && k.access_key_id === previousPortalKey.access_key_id) {
            return { ...k, is_portal: false, is_active: false, status: "Inactive" as const };
          }
          return k;
        });
        const deduped = updatedKeys.filter((k) => k.access_key_id !== key.access_key_id);
        return { ...prev, access_keys: [key, ...deduped] };
      });
    } catch (err) {
      console.error(err);
      setKeyActionError("Impossible de renouveler la clé portail.");
    } finally {
      setRenewingPortalKey(false);
    }
  };

  const handleFetchPortalKey = async () => {
    if (!accountIdForApi) return;
    setPortalKeyLoading(true);
    setPortalKeyError(null);
    try {
      const key = await fetchPortalActiveKey(accountIdForApi);
      setPortalKeyData(key);
      setShowPortalKeyDetails(true);
    } catch (err) {
      console.error(err);
      setPortalKeyError("Impossible de récupérer la clé portail.");
    } finally {
      setPortalKeyLoading(false);
    }
  };

  const handleDeleteKey = async (key: PortalAccessKey) => {
    if (!accountIdForApi || key.is_portal || key.deletable === false) return;
    setKeyActionError(null);
    setLastCreatedKey(null);
    try {
      await deletePortalAccessKey(accountIdForApi, key.access_key_id);
      setState((prev) =>
        prev
          ? { ...prev, access_keys: (prev.access_keys || []).filter((k) => k.access_key_id !== key.access_key_id) }
          : prev
      );
    } catch (err) {
      console.error(err);
      setKeyActionError("Suppression impossible. Vérifiez vos droits.");
    }
  };

  const handleToggleKeyStatus = async (key: PortalAccessKey) => {
    if (!accountIdForApi || key.is_portal || key.deletable === false) return;
    const nextActive = !isPortalKeyActive(key);
    setTogglingKeyId(key.access_key_id);
    setKeyActionError(null);
    setLastCreatedKey(null);
    try {
      const updated = await updatePortalAccessKeyStatus(accountIdForApi, key.access_key_id, nextActive);
      setState((prev) =>
        prev
          ? {
              ...prev,
              access_keys: (prev.access_keys || []).map((k) => (k.access_key_id === updated.access_key_id ? updated : k)),
            }
          : prev
      );
    } catch (err) {
      console.error(err);
      setKeyActionError("Impossible de mettre à jour le statut de la clé.");
    } finally {
      setTogglingKeyId(null);
    }
  };

  const handleCreateBucket = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi || !newBucketName.trim()) return;
    setBucketActionError(null);
    setCreatingBucket(true);
    try {
      const bucket = await createPortalBucket(accountIdForApi, newBucketName.trim());
      setState((prev) =>
        prev ? { ...prev, buckets: [bucket, ...(prev.buckets || [])] } : prev
      );
      setNewBucketName("");
    } catch (err) {
      console.error(err);
      setBucketActionError("Impossible de créer le bucket.");
    } finally {
      setCreatingBucket(false);
    }
  };

  const resetEditPortalUser = () => {
    setEditPortalUser(null);
    setEditPortalBuckets([]);
    setEditPortalSelectedBucket("");
    setEditPortalError(null);
    setEditPortalMessage(null);
    setEditPortalLoading(false);
    setEditPortalSaving(false);
    setEditPortalRemovingBucket(null);
  };

  const openEditPortalUser = (user: PortalUserSummary) => {
    if (!user.id || user.iam_only) return;
    setShowUsersModal(false);
    setEditPortalUser(user);
    setShowEditPortalUserModal(true);
    setEditPortalError(null);
    setEditPortalMessage(null);
    setEditPortalLoading(true);
    if (!accountIdForApi) {
      setEditPortalError("Sélectionnez un compte pour gérer les accès.");
      setEditPortalLoading(false);
      return;
    }
    listPortalUserBuckets(accountIdForApi, user.id)
      .then((resp) => {
        const buckets = resp.buckets || [];
        setEditPortalBuckets(buckets);
        const available = (state?.buckets || []).map((b) => b.name);
        const next = available.find((b) => !buckets.includes(b));
        setEditPortalSelectedBucket(next || "");
      })
      .catch(() => {
        setEditPortalError("Impossible de charger les autorisations de bucket.");
      })
      .finally(() => setEditPortalLoading(false));
  };

  const closeEditPortalUser = () => {
    setShowEditPortalUserModal(false);
    resetEditPortalUser();
  };

  const handleGrantPortalBucket = async () => {
    if (!accountIdForApi || !editPortalUser || !editPortalUser.id || !editPortalSelectedBucket) return;
    setEditPortalSaving(true);
    setEditPortalError(null);
    setEditPortalMessage(null);
    try {
      const resp = await grantPortalUserBucket(accountIdForApi, editPortalUser.id, editPortalSelectedBucket);
      const buckets = resp.buckets || [];
      setEditPortalBuckets(buckets);
      const available = (state?.buckets || []).map((b) => b.name);
      const next = available.find((b) => !buckets.includes(b));
      setEditPortalSelectedBucket(next || "");
      setEditPortalMessage(`Accès ajouté au bucket ${editPortalSelectedBucket}.`);
    } catch (err) {
      console.error(err);
      setEditPortalError("Ajout impossible. Vérifiez vos droits ou le nom du bucket.");
    } finally {
      setEditPortalSaving(false);
    }
  };

  const handleRevokePortalBucket = async (bucketName: string) => {
    if (!accountIdForApi || !editPortalUser || !editPortalUser.id || !bucketName) return;
    setEditPortalRemovingBucket(bucketName);
    setEditPortalError(null);
    setEditPortalMessage(null);
    try {
      const resp = await revokePortalUserBucket(accountIdForApi, editPortalUser.id, bucketName);
      const buckets = resp.buckets || [];
      setEditPortalBuckets(buckets);
      const available = (state?.buckets || []).map((b) => b.name);
      const next = available.find((b) => !buckets.includes(b));
      setEditPortalSelectedBucket(next || "");
      setEditPortalMessage(`Accès retiré du bucket ${bucketName}.`);
    } catch (err) {
      console.error(err);
      setEditPortalError("Retrait impossible. Vérifiez vos droits ou le nom du bucket.");
    } finally {
      setEditPortalRemovingBucket(null);
    }
  };

  const handleAddPortalUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAccountAdmin || !accountIdForApi || !newUserEmail.trim()) return;
    setUserActionError(null);
    setUserActionMessage(null);
    try {
        const created = await addPortalUser(accountIdForApi, newUserEmail.trim());
        setPortalUsers((prev) => [created, ...prev.filter((u) => u.id !== created.id)]);
        setUserActionMessage("Utilisateur ajouté au portail.");
        setNewUserEmail("");
    } catch (err) {
      console.error(err);
      setUserActionError("Ajout impossible. Vérifiez l'email et les droits.");
    }
  };

  const handleRemovePortalUser = async (userId: number) => {
    if (!isAccountAdmin || !accountIdForApi) return;
    setUserActionError(null);
    setUserActionMessage(null);
    setUpdatingUserId(userId);
    try {
      await deletePortalUser(accountIdForApi, userId);
      setPortalUsers((prev) => prev.filter((u) => u.id !== userId));
      setUserActionMessage("Utilisateur retiré du portail.");
    } catch (err) {
      console.error(err);
      setUserActionError("Suppression impossible. Vérifiez vos droits.");
    } finally {
      setUpdatingUserId(null);
    }
  };

  const portalRoleLabel = (role?: string | null) => {
    if (role === "portal_manager") return "Portal manager";
    if (role === "portal_user") return "Portal user";
    if (role === "portal_none") return "No portal";
    return role || "Portal user";
  };

  const portalRoleTone = (role?: string | null): "emerald" | "sky" | "slate" => {
    if (role === "portal_manager") return "emerald";
    if (role === "portal_user" || !role) return "sky";
    return "slate";
  };

  useEffect(() => {
    fetchPortalPublicSettings()
      .then((data) => setPortalSettings(data))
      .catch(() => setPortalSettings({ allow_portal_key: false }));
  }, []);

  const handleChangePortalUserRole = async (userId: number, nextRole: PortalAccountRole) => {
    if (!accountIdForApi || !canManagePortalUsers) return;
    const selfDemote = nextRole === "portal_user" && userId === portalUsers.find((u) => u.email === userEmail)?.id;
    if (selfDemote) {
      setUserActionError("Vous ne pouvez pas retirer vos propres droits de manager.");
      return;
    }
    setUserActionError(null);
    setUserActionMessage(null);
    setUpdatingUserId(userId);
    try {
      const updated = await updatePortalUserRole(accountIdForApi, userId, nextRole);
      setPortalUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: updated.role ?? nextRole } : u)));
      setUserActionMessage(
        nextRole === "portal_manager"
          ? "Utilisateur promu manager du portail."
          : "Rôle portail mis à jour."
      );
    } catch (err) {
      console.error(err);
      setUserActionError("Mise à jour impossible. Vérifiez vos droits.");
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (accountLoading) {
    return <EmptyState title="Chargement..." description="Récupération des comptes et du contexte portail." />;
  }

  if (accountError) {
    return <EmptyState title="Erreur de contexte" description={accountError} />;
  }

  if (!hasAccountContext) {
    return <EmptyState title="Aucun compte sélectionné" description="Sélectionnez un compte dans la barre supérieure pour continuer." />;
  }

  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-sky-600 via-blue-500 to-emerald-500 p-[1px] shadow-lg">
        <div className="grid gap-6 rounded-[22px] bg-white/95 px-6 py-6 shadow-sm dark:bg-slate-900/90 lg:grid-cols-[1fr_1.4fr_1fr]">
          <div className="flex flex-col space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Portail utilisateur</p>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                {selectedAccount?.name || "Compte S3"}
              </h1>
              {(trafficLoading || hasTrafficSparkline) && (
                <div className="mt-3">
                  {trafficLoading ? (
                    <div className="h-16 rounded-2xl border border-white/60 bg-white/50 shadow-inner backdrop-blur-sm animate-pulse dark:border-slate-800/60 dark:bg-slate-900/50" />
                  ) : (
                    <div className="rounded-2xl border border-white/60 bg-white/40 px-3 py-2 shadow-inner ring-1 ring-white/50 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/40 dark:ring-slate-700/60">
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        <span>Traffic 24h</span>
                        <span className="text-[11px] text-slate-800 dark:text-slate-100">{formatBytes(trafficTotal24h)}</span>
                      </div>
                      <div className="text-[10px] font-semibold text-slate-500 text-right dark:text-slate-400">{trafficOps24h.toLocaleString()} req</div>
                      <div className="mt-2 h-16">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trafficSparkline}>
                            <defs>
                              <linearGradient id="portalTrafficSparkline" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.5} />
                                <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Area
                              type="monotone"
                              dataKey="total"
                              stroke="rgba(14,165,233,0.85)"
                              strokeWidth={2}
                              fill="url(#portalTrafficSparkline)"
                              fillOpacity={0.5}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {state?.just_created && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-100">
                  Nouvel utilisateur IAM créé et clé provisionnée
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/80 px-4 py-4 text-sm text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Usage compte</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Volumétrie & objets</p>
                  {accountUsageLoading && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">Chargement…</p>
                  )}
                  {accountUsageError && (
                    <p className="text-[11px] text-rose-600 dark:text-rose-300">{accountUsageError}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap">
                  {renderUsageGauge({
                    label: "Data",
                    used: accountUsedBytes,
                    quota: state?.quota_max_size_bytes,
                    formatter: formatBytes,
                    size: "lg",
                  })}
                  {renderUsageGauge({
                    label: "Objets",
                    used: accountUsedObjects,
                    quota: state?.quota_max_objects,
                    formatter: (v) => {
                      if (v == null) return "—";
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)} M`;
                      if (v >= 10_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)} k`;
                      return v.toLocaleString();
                    },
                    unitHint: "objets",
                    size: "lg",
                  })}
                </div>
              </div>
                <div className="grid grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Utilisateurs</div>
                    <div className="mt-1 text-2xl font-semibold">{portalUsersCount}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Buckets</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold">{visibleBucketCount}</span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">/{totalBucketCount}</span>
                    </div>
                  </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-sm text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
            <div className="space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Endpoint S3</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="block min-w-0 truncate font-mono text-[13px] text-slate-900 dark:text-slate-100"
                    title={state?.s3_endpoint || undefined}
                  >
                    {state?.s3_endpoint || "—"}
                  </span>
                  {state?.s3_endpoint ? (
                    <button
                      type="button"
                      onClick={() => navigator?.clipboard?.writeText?.(state.s3_endpoint ?? "").catch(() => {})}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] text-primary opacity-30 transition hover:opacity-80 hover:bg-slate-200/70 hover:text-sky-600 dark:hover:bg-slate-800/60"
                      aria-label="Copier l'endpoint S3"
                    >
                      <span aria-hidden>📋</span>
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3">
                <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">User</div>
                  <div className="mt-1 font-mono text-[13px] text-slate-900 dark:text-slate-100">{userEmail || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Rôle</div>
                  <div className="mt-1">
                    <Badge label={state?.account_role === "portal_manager" ? "Portal manager" : "Portal user"} tone={state?.account_role === "portal_manager" ? "emerald" : "sky"} />
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">IAM user</div>
                  <div className="mt-1 font-mono text-[13px]">{state?.iam_user?.iam_username || "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Clés IAM</div>
                  <button
                    type="button"
                    onClick={() => setShowKeysModal(true)}
                    className="mt-1 text-sm font-semibold text-slate-700 underline decoration-slate-300 decoration-2 underline-offset-4 transition hover:text-slate-900 dark:text-slate-100 dark:decoration-slate-600 dark:hover:text-white"
                  >
                    {state?.access_keys?.length ?? 0} clé(s)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
          <div className="h-64 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />
        </div>
      ) : (
        <div className="space-y-4">
          {showKeysModal && (
            <Modal title="Clés IAM portail" onClose={() => setShowKeysModal(false)}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-xl">
                    <p className="text-sm text-slate-700 dark:text-slate-200">
                      Clé portail et clés utilisateur IAM pour ce compte.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {portalSettings.allow_portal_key && (
                      <button
                        type="button"
                        onClick={handleRenewPortalKey}
                        disabled={renewingPortalKey || !accountIdForApi || !canManageBuckets || Boolean(togglingKeyId)}
                        aria-label="Renouveler la clé portail"
                        title="Renouveler la clé portail"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 disabled:opacity-50 dark:border-emerald-900/40 dark:text-emerald-200"
                      >
                        <span aria-hidden>{renewingPortalKey ? "…" : "🔄"}</span>
                        <span className="sr-only">Renouveler la clé portail</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleRotateKey}
                      disabled={creatingKey || !accountIdForApi || !canManageBuckets || Boolean(togglingKeyId) || renewingPortalKey}
                      aria-label="Créer une clé utilisateur"
                      title="Créer une clé utilisateur"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
                    >
                      <span aria-hidden>{creatingKey ? "…" : "➕"}</span>
                      <span className="sr-only">Créer une clé utilisateur</span>
                    </button>
                  </div>
                </div>
                {keyActionError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                    {keyActionError}
                  </div>
                )}
                {lastCreatedKey && (
                  <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-sm text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="text-sm font-semibold">Nouvelle clé utilisateur</p>
                    <p className="text-xs text-amber-700 dark:text-amber-200">Le secret est affiché une seule fois.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden title="Access key">🔑</span>
                          <span className="sr-only">Access key</span>
                          <span className="font-mono text-xs text-slate-800 dark:text-amber-100">
                            {lastCreatedKey.accessKey}
                          </span>
                        </div>
                        <CopyButton value={lastCreatedKey.accessKey} label="Copier l'access key" iconOnly />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden title="Secret key">🔒</span>
                          <span className="sr-only">Secret key</span>
                          <span className="font-mono text-xs text-slate-800 dark:text-amber-100">
                            {lastCreatedKey.secretKey}
                          </span>
                        </div>
                        <CopyButton value={lastCreatedKey.secretKey} label="Copier le secret key" iconOnly />
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clés IAM</p>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{orderedAccessKeys.length} clé(s)</span>
                  </div>
                  {portalKeyError && (
                    <div className="text-xs text-rose-600 dark:text-rose-300">{portalKeyError}</div>
                  )}
                  {orderedAccessKeys.length ? (
                    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {orderedAccessKeys.map((k) => {
                        const isActive = isPortalKeyActive(k);
                        const showPortalDetails = Boolean(k.is_portal && showPortalKeyDetails && portalKeyData);
                        return (
                          <div key={k.access_key_id} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`h-2 w-2 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
                                    aria-label={isActive ? "Active" : "Inactive"}
                                    title={isActive ? "Active" : "Inactive"}
                                  />
                                  {k.is_portal && (
                                    <span className="text-xs" aria-label="Clé portail" title="Clé portail">
                                      🛡️
                                    </span>
                                  )}
                                  <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{k.access_key_id}</span>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {k.created_at ? `Créée ${new Date(k.created_at).toLocaleString()}` : "Créée —"}
                                </div>
                                {showPortalDetails && portalKeyData && (
                                  <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span aria-hidden title="Access key">🔑</span>
                                      <span className="font-mono text-slate-800 dark:text-slate-100">
                                        {portalKeyData.access_key_id}
                                      </span>
                                      <CopyButton value={portalKeyData.access_key_id} label="Copier l'access key portail" iconOnly />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span aria-hidden title="Secret key">🔒</span>
                                      {portalKeyData.secret_access_key ? (
                                        <>
                                          <span className="font-mono text-slate-800 dark:text-slate-100">
                                            {portalKeyData.secret_access_key}
                                          </span>
                                          <CopyButton value={portalKeyData.secret_access_key} label="Copier le secret key portail" iconOnly />
                                        </>
                                      ) : (
                                        <span className="text-slate-500 dark:text-slate-400">secret masqué</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {k.is_portal && portalSettings.allow_portal_key && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (portalKeyData) {
                                        setShowPortalKeyDetails((prev) => !prev);
                                      } else {
                                        void handleFetchPortalKey();
                                      }
                                    }}
                                    disabled={portalKeyLoading || !accountIdForApi}
                                    aria-label="Afficher la clé portail"
                                    title="Afficher la clé portail"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
                                  >
                                    <span aria-hidden>{portalKeyLoading ? "…" : showPortalKeyDetails ? "🙈" : "👁️"}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
                                  onClick={() => handleToggleKeyStatus(k)}
                                  disabled={k.is_portal || k.deletable === false || creatingKey || Boolean(togglingKeyId) || renewingPortalKey}
                                  aria-label={isActive ? "Désactiver la clé" : "Activer la clé"}
                                  title={isActive ? "Désactiver la clé" : "Activer la clé"}
                                >
                                  <span aria-hidden>⏻</span>
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 text-rose-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-40 dark:border-rose-900/40 dark:text-rose-300 dark:hover:border-rose-800"
                                  onClick={() => handleDeleteKey(k)}
                                  disabled={k.is_portal || k.deletable === false || creatingKey || Boolean(togglingKeyId) || renewingPortalKey}
                                  aria-label="Supprimer la clé"
                                  title="Supprimer la clé"
                                >
                                  <span aria-hidden>🗑️</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState title="Aucune clé" description="Créez une clé pour commencer." />
                  )}
                </div>
              </div>
            </Modal>
          )}
          {showUsersModal && (
            <Modal
              title="Utilisateurs portail"
              onClose={() => {
                setShowUsersModal(false);
                setFocusedUserKey(null);
              }}
            >
              <div className="space-y-3">
                {canManagePortalUsers && (
                  <form onSubmit={handleAddPortalUser} className="flex flex-wrap items-center gap-2">
                    <input
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="w-64 rounded-full border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="email de l'utilisateur"
                    />
                    <button
                      type="submit"
                      disabled={!newUserEmail.trim()}
                      className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    >
                      Ajouter
                    </button>
                  </form>
                )}
                {userActionError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                    {userActionError}
                  </div>
                )}
                {userActionMessage && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100">
                    {userActionMessage}
                  </div>
                )}
                <div className="space-y-2">
                  {loadingUsers ? (
                    <div className="text-sm text-slate-500 dark:text-slate-300">Chargement…</div>
                  ) : portalUsers.length ? (
                    [...assignedPortalUsers, ...iamOnlyUsers].map((u) => {
                      const role = u.role || "portal_user";
                      const busy = updatingUserId === u.id;
                      const isSelf = userEmail && u.email === userEmail;
                      const isIamOnly = Boolean(u.iam_only);
                      const entryKey = u.id != null ? String(u.id) : u.email ?? "";
                      const isFocused = focusedUserKey && focusedUserKey === entryKey;
                      return (
                        <div
                          key={u.id ?? `${u.email}-iam-only`}
                          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-sm ${
                            isIamOnly
                              ? "border-slate-200 bg-slate-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/70"
                              : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70"
                          } ${isFocused ? "ring-2 ring-primary/60" : ""}`}
                        >
                          <div>
                            <div className="font-medium text-slate-800 dark:text-slate-100">{u.email}</div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              IAM: {u.iam_username || "—"}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge label={isIamOnly ? "IAM (hors portail)" : portalRoleLabel(role)} tone={isIamOnly ? "slate" : portalRoleTone(role)} />
                            </div>
                          </div>
                          {canManagePortalUsers && !isIamOnly && (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowUsersModal(false);
                                  openEditPortalUser(u);
                                }}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700"
                              >
                                Éditer
                              </button>
                              <button
                                type="button"
                                onClick={() => handleChangePortalUserRole(u.id, "portal_user")}
                                disabled={busy || role === "portal_user" || Boolean(isSelf)}
                                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700"
                              >
                                Portal user
                              </button>
                              <button
                                type="button"
                                onClick={() => handleChangePortalUserRole(u.id, "portal_manager")}
                                disabled={busy || role === "portal_manager"}
                                className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                              >
                                Promouvoir manager
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemovePortalUser(u.id)}
                                disabled={busy || Boolean(isSelf)}
                                className="rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-200 dark:hover:bg-rose-900/40"
                              >
                                Retirer
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-slate-500 dark:text-slate-300">Aucun utilisateur portail pour ce compte.</div>
                  )}
                </div>
              </div>
            </Modal>
          )}

          {showEditPortalUserModal && editPortalUser && (
            <Modal title={`Éditer ${editPortalUser.email}`} onClose={closeEditPortalUser}>
              <div className="space-y-4">
                {editPortalError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                    {editPortalError}
                  </div>
                )}
                {editPortalMessage && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100">
                    {editPortalMessage}
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white shadow-sm dark:bg-white dark:text-slate-900">
                      <span aria-hidden>👤</span>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{editPortalUser.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white shadow-sm dark:bg-white dark:text-slate-900">
                      <span aria-hidden>🏷️</span>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Rôle</p>
                      <div className="mt-1">
                        <Badge label={portalRoleLabel(editPortalUser.role)} tone={portalRoleTone(editPortalUser.role)} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800/70">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white shadow-sm dark:bg-white dark:text-slate-900">
                      <span aria-hidden>🔗</span>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">IAM user</p>
                      <p className="text-sm font-mono text-slate-700 dark:text-slate-200">{editPortalUser.iam_username || "—"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>🪣</span>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Accès buckets</p>
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {editPortalBuckets.length} autorisé(s)
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Ajouter</label>
                      <select
                        value={editPortalSelectedBucket}
                        onChange={(e) => setEditPortalSelectedBucket(e.target.value)}
                        disabled={editPortalLoading || editPortalSaving || Boolean(editPortalRemovingBucket) || (state?.buckets || []).length === 0}
                        className="mt-1 w-full rounded-full border border-slate-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="">Sélectionnez un bucket</option>
                        {(state?.buckets || []).map((b) => (
                          <option key={b.name} value={b.name} disabled={editPortalBuckets.includes(b.name)}>
                            {b.name} {editPortalBuckets.includes(b.name) ? "(déjà autorisé)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleGrantPortalBucket}
                      disabled={editPortalLoading || editPortalSaving || Boolean(editPortalRemovingBucket) || !editPortalSelectedBucket}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                    >
                      <span aria-hidden>{editPortalSaving ? "…" : "➕"}</span>
                      {editPortalSaving ? "Ajout..." : "Autoriser"}
                    </button>
                  </div>
                  <div className="mt-3">
                    {editPortalLoading ? (
                      <div className="text-sm text-slate-500 dark:text-slate-400">Chargement…</div>
                    ) : editPortalBuckets.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">Aucun bucket autorisé pour cet utilisateur.</p>
                    ) : (
                      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                        {editPortalBuckets.map((name) => {
                          const removing = editPortalRemovingBucket === name;
                          return (
                            <div key={name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                                <span aria-hidden>🪣</span>
                                <span className="font-mono">{name}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRevokePortalBucket(name)}
                                disabled={editPortalSaving || Boolean(editPortalRemovingBucket)}
                                aria-label={`Retirer l'accès au bucket ${name}`}
                                title={`Retirer l'accès au bucket ${name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
                              >
                                <span aria-hidden>{removing ? "…" : "✕"}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Modal>
          )}
          {showBucketModal && selectedBucket && (
            <PortalBucketModal
              bucket={selectedBucket}
              accountId={accountIdForApi}
              accountUsedBytes={bucketTotalsBytes}
              accountUsedObjects={bucketTotalsObjects}
              onClose={closeBucketModal}
            />
          )}

          {canViewPortalUsers && (
            <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Users</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFocusedUserKey(null);
                    setShowUsersModal(true);
                  }}
                  className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  Gérer les utilisateurs
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 justify-start">
                {loadingUsers ? (
                  <div className="text-sm text-slate-500 dark:text-slate-300">Chargement…</div>
                ) : portalUsers.length ? (
                  [...assignedPortalUsers, ...iamOnlyUsers].map((u) => {
                    const role = u.role || "portal_user";
                    const isIamOnly = Boolean(u.iam_only);
                    return (
                      <div
                        key={u.id ?? `${u.email}-iam-only-card`}
                        role="button"
                        tabIndex={0}
                        onClick={() => openEditPortalUser(u)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openEditPortalUser(u);
                          }
                        }}
                        className={`w-full max-w-xs cursor-pointer rounded-xl border px-3 py-2 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow ${
                          isIamOnly
                            ? "border-slate-200 bg-slate-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/70"
                            : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70"
                        }`}
                      >
                        <div className="font-semibold text-slate-800 dark:text-slate-100">{u.email}</div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          IAM: {u.iam_username || "—"}
                        </div>
                        <div className="mt-1">
                          <Badge label={isIamOnly ? "IAM (hors portail)" : portalRoleLabel(role)} tone={isIamOnly ? "slate" : portalRoleTone(role)} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-slate-500 dark:text-slate-300">Aucun utilisateur portail pour ce compte.</div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Buckets</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={bucketFilter}
                  onChange={(e) => setBucketFilter(e.target.value)}
                  className="w-48 rounded-full border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  placeholder="Rechercher..."
                  aria-label="Filtrer les buckets"
                />
                {canCreateBuckets ? (
                  <form onSubmit={handleCreateBucket} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newBucketName}
                      onChange={(e) => setNewBucketName(e.target.value)}
                      className="w-52 rounded-full border border-slate-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      placeholder="nouveau-bucket"
                    />
                    <button
                      type="submit"
                      disabled={creatingBucket || !newBucketName.trim()}
                      className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-60"
                    >
                      {creatingBucket ? "Création..." : "Créer un bucket"}
                    </button>
                  </form>
                ) : (
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Accès en lecture seule</p>
                )}
              </div>
            </div>
            {bucketActionError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                {bucketActionError}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3 justify-start">
              {state?.buckets?.length ? (
                filteredBuckets.length ? (
                filteredBuckets.map((bucket) => {
                  const used = bucket.used_bytes ?? null;
                  const objectCount = bucket.object_count ?? null;
                  const dataShare = computeRelativeShare(used, bucketTotalsBytes);
                  const objectsShare = computeRelativeShare(objectCount, bucketTotalsObjects);
                  const isStatsLoading = Boolean(bucketStatsLoading[bucket.name]);
                  const usedLabel = isStatsLoading && used == null ? "…" : formatBytes(used);
                  const objectsLabel =
                    isStatsLoading && objectCount == null ? "…" : objectCount == null ? "—" : objectCount.toLocaleString();
                  return (
                    <div
                      key={bucket.name}
                      role="button"
                      tabIndex={0}
                      data-portal-bucket={bucket.name}
                      onClick={() => openBucketModal(bucket)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openBucketModal(bucket);
                        }
                      }}
                      className="w-full max-w-xs cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-800/70"
                    >
                      <div className="flex items-start gap-2 sm:gap-3">
                        <div className="min-w-0">
                          <div
                            className="max-w-[170px] truncate font-semibold text-slate-900 dark:text-white"
                            title={bucket.name}
                          >
                            {bucket.name}
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Créé le {bucket.creation_date ? new Date(bucket.creation_date).toLocaleString() : "—"}
                          </p>
                        </div>
                        <div className="ml-auto flex flex-shrink-0 items-start justify-end gap-2 sm:gap-3">
                          {renderUsageGauge({
                            label: "Data",
                            used,
                            quota: bucketTotalsBytes,
                            formatter: formatBytes,
                            unitHint: undefined,
                            percentOverride: dataShare,
                            bare: true,
                            compact: true,
                            hidePercent: true,
                          })}
                          {renderUsageGauge({
                            label: "Objets",
                            used: objectCount,
                            quota: bucketTotalsObjects,
                            formatter: (v) => (v == null ? "—" : v.toLocaleString()),
                            unitHint: undefined,
                            percentOverride: objectsShare,
                            bare: true,
                            compact: true,
                            hidePercent: true,
                          })}
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Volumétrie</div>
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{usedLabel}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Objets</div>
                          <div className="font-semibold text-slate-800 dark:text-slate-100">{objectsLabel}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
                ) : (
                  <div className="w-full">
                    <EmptyState title="Aucun résultat" description="Aucun bucket ne correspond à la recherche." />
                  </div>
                )
              ) : (
                <div className="w-full">
                  <EmptyState title="Aucun bucket" description="Créez un bucket pour commencer à stocker des objets." />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
