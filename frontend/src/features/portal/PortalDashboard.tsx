/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bucket } from "../../api/buckets";
import { PortalSettings } from "../../api/appSettings";
import {
  fetchPortalWorkspaceHealthOverview,
  HealthCheckStatus,
  WorkspaceEndpointHealthOverviewResponse,
} from "../../api/healthchecks";
import {
  bootstrapPortalIdentity,
  createPortalAccessKey,
  createPortalBucket,
  deletePortalAccessKey,
  deletePortalBucket,
  fetchPortalState,
  PortalAccessKey,
  PortalState,
  PortalUserSummary,
  listPortalUsers,
  updatePortalAccessKeyStatus,
  fetchPortalSettings,
  fetchPortalTraffic,
  fetchPortalBucketStats,
  fetchPortalUsage,
} from "../../api/portal";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useI18n } from "../../i18n";
import { usePortalAccountContext } from "./PortalAccountContext";
import Modal from "../../components/Modal";
import UiBadge from "../../components/ui/UiBadge";
import UiEmptyState from "../../components/ui/UiEmptyState";
import type { UiTone } from "../../components/ui/styles";
import PortalBucketModal from "./PortalBucketModal";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import {
  S3_BUCKET_NAME_MAX_LENGTH as MAX_BUCKET_NAME_LENGTH,
  isValidS3BucketName,
  normalizeS3BucketName,
  normalizeS3BucketNameInput,
} from "../../utils/s3BucketName";
import { extractApiError } from "../../utils/apiError";
import { confirmAction } from "../../utils/confirm";

function CopyButton({ value, label, iconOnly = false }: { value: string; label: string; iconOnly?: boolean }) {
  const handleCopy = () => {
    if (!value) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
  };
  const sizeClass = iconOnly ? "h-7 w-7 ui-caption" : "gap-1 px-3 py-1 ui-caption";
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

function endpointStatusBadge(status: HealthCheckStatus): { label: string; tone: UiTone } {
  if (status === "up") {
    return {
      label: "Up",
      tone: "success",
    };
  }
  if (status === "degraded") {
    return {
      label: "Degraded",
      tone: "warning",
    };
  }
  if (status === "down") {
    return {
      label: "Down",
      tone: "danger",
    };
  }
  return {
    label: "Unknown",
    tone: "neutral",
  };
}

function incidentStateBadge(ongoing: boolean): { label: string; tone: UiTone } {
  if (ongoing) {
    return {
      label: "In progress",
      tone: "warning",
    };
  }
  return {
    label: "Resolved",
    tone: "neutral",
  };
}

function formatIncidentWindow(minutes?: number | null) {
  const value = Math.max(1, Number(minutes ?? 720));
  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `${value} minute${value > 1 ? "s" : ""}`;
}

export default function PortalDashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { generalSettings } = useGeneralSettings();
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
  const [creatingBucket, setCreatingBucket] = useState(false);
  const [deletingBucketFromModal, setDeletingBucketFromModal] = useState(false);
  const [deleteBucketFromModalError, setDeleteBucketFromModalError] = useState<string | null>(null);
  const [showBucketModal, setShowBucketModal] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [newBucketName, setNewBucketName] = useState("");
  const [portalUsers, setPortalUsers] = useState<PortalUserSummary[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(false);
  const [portalSettings, setPortalSettings] = useState<PortalSettings | null>(null);
  const [trafficSparkline, setTrafficSparkline] = useState<{ timestamp: number; total: number; ops: number }[]>([]);
  const [trafficOps24h, setTrafficOps24h] = useState(0);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [bootstrappingIdentity, setBootstrappingIdentity] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const accountUsedBytes = accountUsage?.used_bytes ?? state?.used_bytes ?? null;
  const accountUsedObjects = accountUsage?.used_objects ?? state?.used_objects ?? null;
  const isBucketNameValid = !newBucketName || isValidS3BucketName(newBucketName);
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
  const isPortalUser = state?.account_role === "portal_user";
  const needsIamBootstrap = Boolean(state && !state.iam_provisioned);
  const orderedAccessKeys = useMemo(() => {
    const keys = state?.access_keys ?? [];
    return keys.filter((key) => !key.is_portal);
  }, [state?.access_keys]);
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
  const endpointHealthEntry = workspaceHealth?.endpoints?.[0] ?? null;
  const endpointHealthBadge = endpointStatusBadge(endpointHealthEntry?.status ?? "unknown");
  const localizedEndpointHealthLabel = useMemo(() => {
    if (endpointHealthBadge.label === "Up") return t({ en: "Up", fr: "Disponible", de: "Verfugbar" });
    if (endpointHealthBadge.label === "Degraded") return t({ en: "Degraded", fr: "Degrade", de: "Beeintrachtigt" });
    if (endpointHealthBadge.label === "Down") return t({ en: "Down", fr: "Indisponible", de: "Nicht verfugbar" });
    return t({ en: "Unknown", fr: "Inconnu", de: "Unbekannt" });
  }, [endpointHealthBadge.label, t]);
  const formatIncidentWindowLabel = useCallback(
    (minutes?: number | null) => {
      const value = Math.max(1, Number(minutes ?? 720));
      if (value % 60 === 0) {
        const hours = value / 60;
        return t({
          en: `${hours} hour${hours > 1 ? "s" : ""}`,
          fr: `${hours} heure${hours > 1 ? "s" : ""}`,
          de: `${hours} Stunde${hours > 1 ? "n" : ""}`,
        });
      }
      return t({
        en: `${value} minute${value > 1 ? "s" : ""}`,
        fr: `${value} minute${value > 1 ? "s" : ""}`,
        de: `${value} Minute${value > 1 ? "n" : ""}`,
      });
    },
    [t]
  );
  const orderedIncidents = useMemo(() => {
    const incidents = workspaceHealth?.incidents ?? [];
    return [...incidents].sort((left, right) => {
      if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
      const leftStart = new Date(left.start).getTime();
      const rightStart = new Date(right.start).getTime();
      return rightStart - leftStart;
    });
  }, [workspaceHealth?.incidents]);

  const userEmail = useMemo(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { email?: string | null };
      return parsed.email ?? null;
    } catch {
      return null;
    }
  }, []);

  const canManageBuckets = Boolean(state?.can_manage_buckets);
  const allowPortalUserBucketCreate = Boolean(portalSettings?.allow_portal_user_bucket_create && isPortalUser);
  const allowPortalUserAccessKeyCreate = Boolean(portalSettings?.allow_portal_user_access_key_create && isPortalUser);
  const maxPortalUserAccessKeys = Math.max(1, Math.trunc(Number(portalSettings?.max_portal_user_access_keys ?? 2)));
  const accessKeyLimitReached = orderedAccessKeys.length >= maxPortalUserAccessKeys;
  const canCreateBuckets = canManageBuckets || allowPortalUserBucketCreate;
  const canDeleteBuckets = canCreateBuckets;
  const canCreateAccessKeys = canManageBuckets || allowPortalUserAccessKeyCreate;
  const canCreateMoreAccessKeys = canCreateAccessKeys && !accessKeyLimitReached;
  const selectedBucketStatsLoading = selectedBucket ? Boolean(bucketStatsLoading[selectedBucket.name]) : false;
  const accessKeyLimitReachedMessage = t({
    en: `Maximum IAM user keys reached (${maxPortalUserAccessKeys}). Delete a key before creating a new one.`,
    fr: `Nombre maximal de cles IAM utilisateur atteint (${maxPortalUserAccessKeys}). Supprimez une cle avant d'en creer une nouvelle.`,
    de: `Maximale Anzahl an IAM-Benutzerschlusseln erreicht (${maxPortalUserAccessKeys}). Loschen Sie einen Schlussel, bevor Sie einen neuen erstellen.`,
  });
  const canOpenBucketInBrowser = Boolean(accountIdForApi) && generalSettings.browser_enabled && generalSettings.browser_portal_enabled;
  const canViewPortalUsers = Boolean(state?.can_manage_portal_users);
  const assignedPortalUsers = useMemo(() => portalUsers.filter((u) => !u.iam_only), [portalUsers]);
  const portalUsersCount = canViewPortalUsers ? (loadingUsers ? "…" : assignedPortalUsers.length) : "-";
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
    setDeleteBucketFromModalError(null);
    setSelectedBucket(bucket);
    setShowBucketModal(true);
    void loadBucketStats(bucket.name);
  };

  const closeBucketModal = () => {
    setDeleteBucketFromModalError(null);
    setDeletingBucketFromModal(false);
    setShowBucketModal(false);
    setSelectedBucket(null);
  };

  const openBucketInBrowser = useCallback(
    (bucket: Bucket) => {
      if (!accountIdForApi || !generalSettings.browser_enabled || !generalSettings.browser_portal_enabled) return;
      if (typeof window !== "undefined") {
        localStorage.setItem("selectedPortalAccountId", String(accountIdForApi));
      }
      navigate(`/portal/browser?bucket=${encodeURIComponent(bucket.name)}`);
    },
    [accountIdForApi, generalSettings.browser_enabled, generalSettings.browser_portal_enabled, navigate]
  );

  const handleBucketPrimaryAction = (bucket: Bucket) => {
    if (canOpenBucketInBrowser) {
      openBucketInBrowser(bucket);
      return;
    }
    openBucketModal(bucket);
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
    hoverHint,
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
    hoverHint?: string;
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
    const labelText = compact
      ? "text-[0.55rem] leading-[0.65rem] tracking-tight"
      : size === "lg"
      ? "ui-caption"
      : size === "sm"
      ? "ui-caption"
      : "ui-caption";
    const valueText = compact ? "text-[0.55rem] leading-[0.65rem]" : size === "lg" ? "ui-caption" : "ui-caption";
    const widthClass = size === "lg" ? "min-w-[180px]" : size === "sm" ? "min-w-[120px]" : "min-w-[150px]";
    const wrapperClasses = bare
      ? "flex items-center gap-2 ui-caption text-slate-600 dark:text-slate-300"
      : `flex items-center gap-2 rounded-xl border border-slate-200 bg-white ui-caption shadow-sm dark:border-slate-700 dark:bg-slate-900/70 ${
          size === "lg" ? "px-4 py-3" : "px-3 py-2"
        } ${widthClass}`;
    return (
      <div className={wrapperClasses}>
        <div
          className={`relative ${sizeClasses} rounded-full bg-slate-100 dark:bg-slate-800`}
          style={gradient ? { backgroundImage: gradient } : undefined}
          aria-label={`${label} ${percentLabel}`}
          title={hoverHint ?? `${label}: ${percentLabel}`}
        >
          <div className="absolute inset-1 rounded-full bg-white dark:bg-slate-900" />
          <div className="absolute inset-2 flex flex-col items-center justify-center text-center font-semibold text-slate-700 dark:text-slate-100">
            <span className={`${labelText} uppercase text-slate-500 dark:text-slate-400`}>{label}</span>
            {!hidePercent && <span className={valueText}>{percentLabel}</span>}
          </div>
        </div>
        {!bare && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
              <span>{display}</span>
              {unitHint ? <span className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">{unitHint}</span> : null}
            </div>
            {quotaDisplay ? (
              <div className="ui-caption text-slate-500 dark:text-slate-400">
                / {quotaDisplay}
                {unitHint && unitHint !== "Sans quota" ? ` ${unitHint}` : ""}
              </div>
            ) : (
              <div className="ui-caption text-slate-500 dark:text-slate-400">Sans quota</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderShareIndicator = ({
    label,
    percentOverride,
    hoverHint,
  }: {
    label: string;
    percentOverride?: number | null;
    hoverHint?: string;
  }) => {
    const ratio = percentOverride ?? null;
    const percentLabel = ratio !== null ? `${Math.round(ratio)}%` : "N/A";
    const gradient =
      ratio === null
        ? undefined
        : `conic-gradient(var(--tw-color-primary, #0ea5e9) ${ratio}%, rgba(148,163,184,0.24) ${ratio}%)`;
    return (
      <div
        className="relative h-8 w-8 flex-shrink-0 rounded-full bg-slate-100 dark:bg-slate-800"
        style={gradient ? { backgroundImage: gradient } : undefined}
        aria-label={`${label} ${percentLabel}`}
        title={hoverHint ?? `${label}: ${percentLabel}`}
      >
        <div className="absolute inset-[4px] rounded-full bg-white dark:bg-slate-900" />
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
        setBootstrapError(null);
        const data = await fetchPortalState(accountIdForApi);
        if (!cancelled) {
          setState(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load portal information.",
                fr: "Impossible de charger les informations du portail.",
                de: "Portal-Informationen konnen nicht geladen werden.",
              })
            )
          );
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
  }, [accountIdForApi, hasAccountContext, t]);

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
        setAccountUsageError(
          extractApiError(
            err,
            t({
              en: "Account usage unavailable.",
              fr: "Usage du compte indisponible.",
              de: "Kontonutzung nicht verfugbar.",
            })
          )
        );
      })
      .finally(() => {
        if (!cancelled) {
          setAccountUsageLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, t]);

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
        const stats = await fetchPortalTraffic(accountIdForApi, "week");
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
        setLoadingUsers(false);
        return;
      }
      try {
        setLoadingUsers(true);
        const data = await listPortalUsers(accountIdForApi);
        if (!cancelled) {
          setPortalUsers(data);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPortalUsers([]);
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
    if (accessKeyLimitReached) {
      setKeyActionError(accessKeyLimitReachedMessage);
      return;
    }
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
      setKeyActionError(
        extractApiError(
          err,
          t({
            en: "Unable to create a new key. Check your IAM permissions.",
            fr: "Impossible de creer une nouvelle cle. Verifiez vos droits IAM.",
            de: "Neuer Schlussel kann nicht erstellt werden. Prufen Sie Ihre IAM-Berechtigungen.",
          })
        )
      );
    } finally {
      setCreatingKey(false);
    }
  };

  const handleBootstrapIdentity = async () => {
    if (!accountIdForApi) return;
    setBootstrappingIdentity(true);
    setBootstrapError(null);
    try {
      const data = await bootstrapPortalIdentity(accountIdForApi);
      setState(data);
      setKeyActionError(null);
      setBucketActionError(null);
      setError(null);
    } catch (err) {
      console.error(err);
      setBootstrapError(
        extractApiError(
          err,
          t({
            en: "Unable to initialize IAM identity for this portal account.",
            fr: "Impossible d'initialiser l'identite IAM pour ce compte portail.",
            de: "Die IAM-Identitat fur dieses Portal-Konto kann nicht initialisiert werden.",
          })
        )
      );
    } finally {
      setBootstrappingIdentity(false);
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
      setKeyActionError(
        extractApiError(
          err,
          t({
            en: "Delete failed. Check your permissions.",
            fr: "Suppression impossible. Verifiez vos droits.",
            de: "Loschen fehlgeschlagen. Prufen Sie Ihre Berechtigungen.",
          })
        )
      );
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
      setKeyActionError(
        extractApiError(
          err,
          t({
            en: "Unable to update key status.",
            fr: "Impossible de mettre a jour le statut de la cle.",
            de: "Schlusselstatus kann nicht aktualisiert werden.",
          })
        )
      );
    } finally {
      setTogglingKeyId(null);
    }
  };

  const handleDeleteBucketFromModal = async () => {
    if (!accountIdForApi || !selectedBucket || !canDeleteBuckets || deletingBucketFromModal) return;
    if (selectedBucket.object_count !== 0) return;
    const bucketName = selectedBucket.name;
    const confirmed = confirmAction(
      t({
        en: `Delete bucket '${bucketName}'?`,
        fr: `Supprimer le bucket '${bucketName}' ?`,
        de: `Bucket '${bucketName}' loschen?`,
      })
    );
    if (!confirmed) return;
    setDeletingBucketFromModal(true);
    setDeleteBucketFromModalError(null);
    setBucketActionError(null);
    try {
      await deletePortalBucket(accountIdForApi, bucketName, false);
      bucketStatsLoadedRef.current.delete(bucketName);
      setBucketStatsLoading((prev) => {
        if (!prev[bucketName]) return prev;
        const next = { ...prev };
        delete next[bucketName];
        return next;
      });
      setState((prev) => {
        if (!prev) return prev;
        const nextBuckets = (prev.buckets || []).filter((bucket) => bucket.name !== bucketName);
        const nextTotal =
          prev.total_buckets == null ? prev.total_buckets : Math.max(0, prev.total_buckets - 1);
        return {
          ...prev,
          buckets: nextBuckets,
          total_buckets: nextTotal,
        };
      });
      setDeleteBucketFromModalError(null);
      setShowBucketModal(false);
      setSelectedBucket(null);
    } catch (err) {
      console.error(err);
      setDeleteBucketFromModalError(
        extractApiError(
          err,
          t({
            en: "Unable to delete bucket.",
            fr: "Impossible de supprimer le bucket.",
            de: "Bucket kann nicht geloscht werden.",
          })
        )
      );
    } finally {
      setDeletingBucketFromModal(false);
    }
  };

  const handleCreateBucket = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedBucketName = normalizeS3BucketName(newBucketName);
    if (!accountIdForApi || !normalizedBucketName || !isValidS3BucketName(normalizedBucketName)) {
      setBucketActionError(
        t({
          en: "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.",
          fr: "Nom invalide. 3-63 caracteres, minuscules, chiffres, points ou tirets.",
          de: "Ungueltiger Name. 3-63 Zeichen, Kleinbuchstaben, Zahlen, Punkte oder Bindestriche.",
        })
      );
      return;
    }
    setBucketActionError(null);
    setCreatingBucket(true);
    try {
      const bucket = await createPortalBucket(accountIdForApi, normalizedBucketName);
      setState((prev) =>
        prev ? { ...prev, buckets: [bucket, ...(prev.buckets || [])] } : prev
      );
      setNewBucketName("");
    } catch (err) {
      console.error(err);
      setBucketActionError(
        t({
          en: "Unable to create bucket.",
          fr: "Impossible de creer le bucket.",
          de: "Bucket kann nicht erstellt werden.",
        })
      );
    } finally {
      setCreatingBucket(false);
    }
  };

  useEffect(() => {
    if (!accountIdForApi) {
      setPortalSettings(null);
      return;
    }
    fetchPortalSettings(accountIdForApi)
      .then((data) => setPortalSettings(data))
      .catch(() => setPortalSettings(null));
  }, [accountIdForApi]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled || !hasAccountContext || !accountIdForApi) {
      setWorkspaceHealth(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    fetchPortalWorkspaceHealthOverview(accountIdForApi)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceHealth(null);
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountIdForApi, generalSettings.endpoint_status_enabled, hasAccountContext]);

  if (accountLoading) {
    return (
      <UiEmptyState
        title={t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}
        description={t({
          en: "Retrieving accounts and portal context.",
          fr: "Recuperation des comptes et du contexte portail.",
          de: "Konten und Portal-Kontext werden abgerufen.",
        })}
      />
    );
  }

  if (accountError) {
    return <UiEmptyState title={t({ en: "Context error", fr: "Erreur de contexte", de: "Kontextfehler" })} description={accountError} />;
  }

  if (!hasAccountContext) {
    return (
      <UiEmptyState
        title={t({ en: "No account selected", fr: "Aucun compte selectionne", de: "Kein Konto ausgewahlt" })}
        description={t({
          en: "Select an account in the top bar to continue.",
          fr: "Selectionnez un compte dans la barre superieure pour continuer.",
          de: "Wahlen Sie ein Konto in der oberen Leiste, um fortzufahren.",
        })}
      />
    );
  }

  return (
    <div className="space-y-8">
      {needsIamBootstrap && (
        <section className="ui-surface-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
                {t({ en: "IAM identity required", fr: "Identite IAM requise", de: "IAM-Identitat erforderlich" })}
              </p>
              <p className="ui-caption text-slate-600 dark:text-slate-300">
                {t({
                  en: "Initialize the portal IAM identity before using bucket and key workflows.",
                  fr: "Initialisez l'identite IAM du portail avant d'utiliser les workflows buckets et cles.",
                  de: "Initialisieren Sie die Portal-IAM-Identitat, bevor Sie Bucket- und Schlussel-Workflows verwenden.",
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={handleBootstrapIdentity}
              disabled={bootstrappingIdentity || !accountIdForApi}
              className="rounded-md bg-primary px-4 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
            >
              {bootstrappingIdentity
                ? t({ en: "Initializing...", fr: "Initialisation...", de: "Initialisierung..." })
                : t({ en: "Initialize IAM", fr: "Initialiser IAM", de: "IAM initialisieren" })}
            </button>
          </div>
          {bootstrapError && <p className="mt-3 ui-caption text-rose-600 dark:text-rose-300">{bootstrapError}</p>}
        </section>
      )}
      <div className="overflow-hidden rounded-3xl bg-gradient-to-r from-sky-600 via-blue-500 to-emerald-500 p-[1px] shadow-lg">
        <div className="grid gap-6 rounded-[22px] bg-white/95 px-6 py-6 shadow-sm dark:bg-slate-900/90 lg:grid-cols-[1fr_1.4fr_1fr]">
          <div className="flex flex-col space-y-4">
            <div>
              <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t({ en: "User portal", fr: "Portail utilisateur", de: "Benutzerportal" })}
              </p>
              <h1 className="mt-2 ui-title font-semibold text-slate-900 dark:text-white">
                {selectedAccount?.name || t({ en: "S3 account", fr: "Compte S3", de: "S3-Konto" })}
              </h1>
              {(trafficLoading || hasTrafficSparkline) && (
                <div className="mt-3">
                  {trafficLoading ? (
                    <div className="h-16 rounded-2xl border border-white/60 bg-white/50 shadow-inner backdrop-blur-sm animate-pulse dark:border-slate-800/60 dark:bg-slate-900/50" />
                  ) : (
                    <div className="rounded-2xl border border-white/60 bg-white/40 px-3 py-2 shadow-inner ring-1 ring-white/50 backdrop-blur-sm dark:border-slate-800/70 dark:bg-slate-900/40 dark:ring-slate-700/60">
                      <div className="flex items-center justify-between ui-caption font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        <span>{t({ en: "Traffic 24h", fr: "Trafic 24h", de: "Traffic 24h" })}</span>
                        <span className="ui-caption text-slate-800 dark:text-slate-100">{formatBytes(trafficTotal24h)}</span>
                      </div>
                      <div className="ui-caption font-semibold text-slate-500 text-right dark:text-slate-400">
                        {t({
                          en: `${trafficOps24h.toLocaleString()} req`,
                          fr: `${trafficOps24h.toLocaleString()} req`,
                          de: `${trafficOps24h.toLocaleString()} Anfr`,
                        })}
                      </div>
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
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 ui-caption font-semibold text-emerald-700 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-100">
                  {t({
                    en: "New IAM user created and key provisioned",
                    fr: "Nouvel utilisateur IAM cree et cle provisionnee",
                    de: "Neuer IAM-Benutzer erstellt und Schlussel bereitgestellt",
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/80 px-4 py-4 ui-body text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t({ en: "Account usage", fr: "Usage compte", de: "Kontonutzung" })}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {t({ en: "Storage & objects", fr: "Volumetrie & objets", de: "Speicher & Objekte" })}
                  </p>
                  {accountUsageLoading && (
                    <p className="ui-caption text-slate-400 dark:text-slate-500">
                      {t({ en: "Loading...", fr: "Chargement...", de: "Wird geladen..." })}
                    </p>
                  )}
                  {accountUsageError && (
                    <p className="ui-caption text-rose-600 dark:text-rose-300">{accountUsageError}</p>
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
                    label: t({ en: "Objects", fr: "Objets", de: "Objekte" }),
                    used: accountUsedObjects,
                    quota: state?.quota_max_objects,
                    formatter: (v) => {
                      if (v == null) return "—";
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)} M`;
                      if (v >= 10_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)} k`;
                      return v.toLocaleString();
                    },
                    unitHint: t({ en: "objects", fr: "objets", de: "Objekte" }),
                    size: "lg",
                  })}
                </div>
              </div>
                <div className="grid grid-cols-2 gap-4 sm:gap-6">
                  <div>
                    <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t({ en: "Users", fr: "Utilisateurs", de: "Benutzer" })}
                    </div>
                    <div className="mt-1 ui-metric font-semibold">{portalUsersCount}</div>
                  </div>
                  <div>
                    <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t({ en: "Buckets", fr: "Buckets", de: "Buckets" })}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="ui-metric font-semibold">{visibleBucketCount}</span>
                      <span className="ui-body text-slate-500 dark:text-slate-400">/{totalBucketCount}</span>
                    </div>
                  </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/80 px-4 py-3 ui-body text-slate-800 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t({ en: "S3 endpoint", fr: "Endpoint S3", de: "S3-Endpunkt" })}
                  </div>
                  {generalSettings.endpoint_status_enabled && (
                    workspaceHealthLoading ? (
                      <span className="inline-flex h-5 w-12 animate-pulse rounded-full bg-slate-200/80 dark:bg-slate-700/80" aria-hidden />
                    ) : (
                      <UiBadge
                        tone={endpointHealthBadge.tone}
                        title={
                          endpointHealthEntry?.checked_at
                            ? t({
                                en: `Last check: ${new Date(endpointHealthEntry.checked_at).toLocaleString()}`,
                                fr: `Derniere verification: ${new Date(endpointHealthEntry.checked_at).toLocaleString()}`,
                                de: `Letzte Prufung: ${new Date(endpointHealthEntry.checked_at).toLocaleString()}`,
                              })
                            : t({ en: "Last check: unavailable", fr: "Derniere verification: indisponible", de: "Letzte Prufung: nicht verfugbar" })
                        }
                      >
                        {localizedEndpointHealthLabel}
                      </UiBadge>
                    )
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="block min-w-0 truncate font-mono ui-caption text-slate-900 dark:text-slate-100"
                    title={state?.s3_endpoint || undefined}
                  >
                    {state?.s3_endpoint || "—"}
                  </span>
                  {state?.s3_endpoint ? (
                    <button
                      type="button"
                      onClick={() => navigator?.clipboard?.writeText?.(state.s3_endpoint ?? "").catch(() => {})}
                      className="flex h-6 w-6 items-center justify-center rounded-full ui-caption text-primary opacity-30 transition hover:opacity-80 hover:bg-slate-200/70 hover:text-primary-600 dark:hover:bg-slate-800/60"
                      aria-label={t({ en: "Copy S3 endpoint", fr: "Copier l'endpoint S3", de: "S3-Endpunkt kopieren" })}
                    >
                      <span aria-hidden>📋</span>
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3">
                <div>
                <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t({ en: "User", fr: "Utilisateur", de: "Benutzer" })}
                </div>
                  <div className="mt-1 font-mono ui-caption text-slate-900 dark:text-slate-100">{userEmail || "—"}</div>
                </div>
                <div>
                  <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t({ en: "Role", fr: "Role", de: "Rolle" })}
                  </div>
                  <div className="mt-1">
                    <UiBadge tone={state?.account_role === "portal_manager" ? "success" : "info"}>
                      {state?.account_role === "portal_manager"
                        ? t({ en: "Portal manager", fr: "Portal manager", de: "Portal-Manager" })
                        : t({ en: "Portal user", fr: "Portal user", de: "Portal-Benutzer" })}
                    </UiBadge>
                  </div>
                </div>
                <div>
                  <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t({ en: "IAM user", fr: "Utilisateur IAM", de: "IAM-Benutzer" })}
                  </div>
                  <div className="mt-1 font-mono ui-caption">{state?.iam_user?.iam_username || "—"}</div>
                </div>
                <div>
                  <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {t({ en: "IAM keys", fr: "Cles IAM", de: "IAM-Schlussel" })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowKeysModal(true)}
                    className="mt-1 ui-body font-semibold text-slate-700 underline decoration-slate-300 decoration-2 underline-offset-4 transition hover:text-slate-900 dark:text-slate-100 dark:decoration-slate-600 dark:hover:text-white"
                  >
                    {t({
                      en: `${orderedAccessKeys.length} key(s)`,
                      fr: `${orderedAccessKeys.length} cle(s)`,
                      de: `${orderedAccessKeys.length} Schlussel`,
                    })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {generalSettings.endpoint_status_enabled && hasAccountContext && (workspaceHealthLoading || orderedIncidents.length > 0) && (
        <section className="ui-surface-card p-4">
          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">
            {t({ en: "Ongoing / Recent Incidents", fr: "Incidents en cours / recents", de: "Laufende / aktuelle Vorfalle" })}
          </p>
          <p className="ui-caption text-slate-500 dark:text-slate-400">
            {t({
              en: `Ongoing incidents and incidents ended in the last ${formatIncidentWindowLabel(workspaceHealth?.incident_highlight_minutes)}.`,
              fr: `Incidents en cours et incidents termines dans les ${formatIncidentWindowLabel(workspaceHealth?.incident_highlight_minutes)} dernieres.`,
              de: `Laufende Vorfalle und in den letzten ${formatIncidentWindowLabel(workspaceHealth?.incident_highlight_minutes)} beendete Vorfalle.`,
            })}
          </p>
          {workspaceHealthLoading ? (
            <div className="mt-3 h-24 animate-pulse rounded-xl border border-slate-200/80 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/70" />
          ) : (
            <div className="mt-3 space-y-2">
              {orderedIncidents.slice(0, 5).map((incident, index) => (
                <div
                  key={`${incident.endpoint_id}-${incident.start}-${index}`}
                  className={`rounded-lg border px-3 py-2 ${
                    incident.ongoing
                      ? "border-amber-200/90 bg-amber-50/80 dark:border-amber-800/60 dark:bg-amber-900/20"
                      : "border-slate-200/90 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="ui-caption font-semibold text-slate-900 dark:text-slate-100">{incident.endpoint_name}</p>
                    <div className="flex items-center gap-1.5">
                      <UiBadge tone={incidentStateBadge(incident.ongoing).tone}>
                        {incident.ongoing
                          ? t({ en: "In progress", fr: "En cours", de: "Laufend" })
                          : t({ en: "Resolved", fr: "Resolu", de: "Behoben" })}
                      </UiBadge>
                      <UiBadge tone={endpointStatusBadge(incident.status).tone}>
                        {endpointStatusBadge(incident.status).label === "Up"
                          ? t({ en: "Up", fr: "Disponible", de: "Verfugbar" })
                          : endpointStatusBadge(incident.status).label === "Degraded"
                            ? t({ en: "Degraded", fr: "Degrade", de: "Beeintrachtigt" })
                            : endpointStatusBadge(incident.status).label === "Down"
                              ? t({ en: "Down", fr: "Indisponible", de: "Nicht verfugbar" })
                              : t({ en: "Unknown", fr: "Inconnu", de: "Unbekannt" })}
                      </UiBadge>
                    </div>
                  </div>
                  <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                    {incident.ongoing
                      ? t({ en: "Ongoing since", fr: "En cours depuis", de: "Lauft seit" })
                      : t({ en: "From", fr: "Du", de: "Von" })}{" "}
                    {new Date(incident.start).toLocaleString()}
                    {incident.end
                      ? t({
                          en: ` to ${new Date(incident.end).toLocaleString()}`,
                          fr: ` au ${new Date(incident.end).toLocaleString()}`,
                          de: ` bis ${new Date(incident.end).toLocaleString()}`,
                        })
                      : ""}
                  </p>
                </div>
              ))}
              {orderedIncidents.length > 5 && (
                <p className="ui-caption text-slate-500 dark:text-slate-400">
                  {t({
                    en: `+${orderedIncidents.length - 5} more incident(s).`,
                    fr: `+${orderedIncidents.length - 5} incident(s) supplementaire(s).`,
                    de: `+${orderedIncidents.length - 5} weitere Vorfalle.`,
                  })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 ui-body text-rose-700 shadow-sm dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100">
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
            <Modal title={t({ en: "IAM keys", fr: "Cles IAM", de: "IAM-Schlussel" })} onClose={() => setShowKeysModal(false)}>
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-xl">
                    <p className="ui-body text-slate-700 dark:text-slate-200">
                      {t({
                        en: "IAM user keys for this account.",
                        fr: "Cles utilisateur IAM pour ce compte.",
                        de: "IAM-Benutzerschlussel fur dieses Konto.",
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRotateKey}
                      disabled={creatingKey || !accountIdForApi || !canCreateMoreAccessKeys || Boolean(togglingKeyId)}
                      aria-label={t({ en: "Create user key", fr: "Creer une cle utilisateur", de: "Benutzerschlussel erstellen" })}
                      title={
                        accessKeyLimitReached
                          ? accessKeyLimitReachedMessage
                          : t({ en: "Create user key", fr: "Creer une cle utilisateur", de: "Benutzerschlussel erstellen" })
                      }
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-600"
                    >
                      <span aria-hidden>{creatingKey ? "…" : "➕"}</span>
                      <span className="sr-only">{t({ en: "Create user key", fr: "Creer une cle utilisateur", de: "Benutzerschlussel erstellen" })}</span>
                    </button>
                  </div>
                </div>
                {keyActionError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                    {keyActionError}
                  </div>
                )}
                {lastCreatedKey && (
                  <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2 ui-body text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="ui-body font-semibold">Nouvelle clé utilisateur</p>
                    <p className="ui-caption text-amber-700 dark:text-amber-200">
                      {t({ en: "Secret is shown only once.", fr: "Le secret est affiche une seule fois.", de: "Das Secret wird nur einmal angezeigt." })}
                    </p>
                    <div className="mt-2 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden title="Access key">🔑</span>
                          <span className="sr-only">Access key</span>
                          <span className="font-mono ui-caption text-slate-800 dark:text-amber-100">
                            {lastCreatedKey.accessKey}
                          </span>
                        </div>
                        <CopyButton
                          value={lastCreatedKey.accessKey}
                          label={t({ en: "Copy access key", fr: "Copier l'access key", de: "Access Key kopieren" })}
                          iconOnly
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden title="Secret key">🔒</span>
                          <span className="sr-only">Secret key</span>
                          <span className="font-mono ui-caption text-slate-800 dark:text-amber-100">
                            {lastCreatedKey.secretKey}
                          </span>
                        </div>
                        <CopyButton
                          value={lastCreatedKey.secretKey}
                          label={t({ en: "Copy secret key", fr: "Copier le secret key", de: "Secret Key kopieren" })}
                          iconOnly
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {t({ en: "IAM keys", fr: "Cles IAM", de: "IAM-Schlussel" })}
                    </p>
                    <span className="ui-caption text-slate-400 dark:text-slate-500">
                      {t({
                        en: `${orderedAccessKeys.length} key(s)`,
                        fr: `${orderedAccessKeys.length} cle(s)`,
                        de: `${orderedAccessKeys.length} Schlussel`,
                      })}
                    </span>
                  </div>
                  <p className={`ui-caption ${accessKeyLimitReached ? "text-amber-600 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}>
                    {t({
                      en: `${orderedAccessKeys.length}/${maxPortalUserAccessKeys} user key(s)`,
                      fr: `${orderedAccessKeys.length}/${maxPortalUserAccessKeys} cle(s) utilisateur`,
                      de: `${orderedAccessKeys.length}/${maxPortalUserAccessKeys} Benutzerschlussel`,
                    })}
                  </p>
                  {accessKeyLimitReached && <p className="ui-caption text-amber-600 dark:text-amber-300">{accessKeyLimitReachedMessage}</p>}
                  {orderedAccessKeys.length ? (
                    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {orderedAccessKeys.map((k) => {
                        const isActive = isPortalKeyActive(k);
                        const statusLabel = isActive
                          ? t({ en: "Active", fr: "Active", de: "Aktiv" })
                          : t({ en: "Inactive", fr: "Inactive", de: "Inaktiv" });
                        return (
                          <div key={k.access_key_id} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`}
                                    aria-label={statusLabel}
                                    title={statusLabel}
                                  />
                                  <span className="font-mono ui-caption text-slate-700 dark:text-slate-200">{k.access_key_id}</span>
                                  <span
                                    className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                                      isActive
                                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/30 dark:text-emerald-100"
                                        : "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100"
                                    }`}
                                  >
                                    {statusLabel}
                                  </span>
                                </div>
                                <div className="ui-caption text-slate-500 dark:text-slate-400">
                                  {k.created_at
                                    ? t({
                                        en: `Created ${new Date(k.created_at).toLocaleString()}`,
                                        fr: `Creee ${new Date(k.created_at).toLocaleString()}`,
                                        de: `Erstellt ${new Date(k.created_at).toLocaleString()}`,
                                      })
                                    : t({ en: "Created -", fr: "Creee -", de: "Erstellt -" })}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                                    isActive
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100 dark:hover:border-emerald-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:border-amber-700"
                                  }`}
                                  onClick={() => handleToggleKeyStatus(k)}
                                  disabled={
                                    !canCreateAccessKeys ||
                                    k.is_portal ||
                                    k.deletable === false ||
                                    creatingKey ||
                                    Boolean(togglingKeyId)
                                  }
                                  aria-label={
                                    isActive
                                      ? t({ en: "Disable key", fr: "Desactiver la cle", de: "Schlussel deaktivieren" })
                                      : t({ en: "Enable key", fr: "Activer la cle", de: "Schlussel aktivieren" })
                                  }
                                  title={
                                    isActive
                                      ? t({ en: "Disable key", fr: "Desactiver la cle", de: "Schlussel deaktivieren" })
                                      : t({ en: "Enable key", fr: "Activer la cle", de: "Schlussel aktivieren" })
                                  }
                                >
                                  <span aria-hidden>⏻</span>
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 text-rose-600 transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-40 dark:border-rose-900/40 dark:text-rose-300 dark:hover:border-rose-800"
                                  onClick={() => handleDeleteKey(k)}
                                  disabled={
                                    !canCreateAccessKeys ||
                                    k.is_portal ||
                                    k.deletable === false ||
                                    creatingKey ||
                                    Boolean(togglingKeyId)
                                  }
                                  aria-label={t({ en: "Delete key", fr: "Supprimer la cle", de: "Schlussel loschen" })}
                                  title={t({ en: "Delete key", fr: "Supprimer la cle", de: "Schlussel loschen" })}
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
                    <UiEmptyState
                      title={t({ en: "No key", fr: "Aucune cle", de: "Kein Schlussel" })}
                      description={t({ en: "Create a key to get started.", fr: "Creez une cle pour commencer.", de: "Erstellen Sie einen Schlussel, um zu starten." })}
                    />
                  )}
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
              canDeleteBucket={canDeleteBuckets}
              deletingBucket={deletingBucketFromModal}
              deleteError={deleteBucketFromModalError}
              bucketStatsLoading={selectedBucketStatsLoading}
              onDeleteBucket={handleDeleteBucketFromModal}
            />
          )}

          <div className="ui-surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t({ en: "Buckets", fr: "Buckets", de: "Buckets" })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={bucketFilter}
                  onChange={(e) => setBucketFilter(e.target.value)}
                  className="w-48 rounded-full border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  placeholder={t({ en: "Search...", fr: "Rechercher...", de: "Suchen..." })}
                  aria-label={t({ en: "Filter buckets", fr: "Filtrer les buckets", de: "Buckets filtern" })}
                />
                {canCreateBuckets ? (
                  <form onSubmit={handleCreateBucket} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newBucketName}
                      onChange={(e) => setNewBucketName(normalizeS3BucketNameInput(e.target.value))}
                      maxLength={MAX_BUCKET_NAME_LENGTH}
                      title={
                        isBucketNameValid
                          ? undefined
                          : t({
                              en: "Invalid name. 3-63 characters, lowercase letters, numbers, dots or hyphens.",
                              fr: "Nom invalide. 3-63 caracteres, minuscules, chiffres, points ou tirets.",
                              de: "Ungueltiger Name. 3-63 Zeichen, Kleinbuchstaben, Zahlen, Punkte oder Bindestriche.",
                            })
                      }
                      className={`w-52 rounded-full border px-3 py-2 ui-body focus:outline-none focus:ring-2 ${
                        isBucketNameValid
                          ? "border-slate-200 focus:border-primary focus:ring-primary/30 dark:border-slate-700"
                          : "border-rose-400 text-rose-700 focus:border-rose-500 focus:ring-rose-200 dark:border-rose-500 dark:text-rose-200 dark:focus:ring-rose-900/50"
                      } dark:bg-slate-900 dark:text-slate-100`}
                      placeholder={t({ en: "new-bucket", fr: "nouveau-bucket", de: "neuer-bucket" })}
                    />
                    <button
                      type="submit"
                      disabled={creatingBucket || !newBucketName.trim() || !isBucketNameValid}
                      className="rounded-full bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                    >
                      {creatingBucket
                        ? t({ en: "Creating...", fr: "Creation...", de: "Erstellung..." })
                        : t({ en: "Create bucket", fr: "Creer un bucket", de: "Bucket erstellen" })}
                    </button>
                  </form>
                ) : (
                  <p className="ui-caption font-semibold text-slate-500 dark:text-slate-400">
                    {t({ en: "Read-only access", fr: "Acces en lecture seule", de: "Nur-Lese-Zugriff" })}
                  </p>
                )}
              </div>
            </div>
            {bucketActionError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
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
                      data-portal-bucket={bucket.name}
                      className="w-full max-w-xs rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 ui-body shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/70"
                    >
                      <div className="flex items-start gap-2 sm:gap-2.5">
                        <button
                          type="button"
                          onClick={() => openBucketModal(bucket)}
                          aria-label={t({ en: `Bucket information for ${bucket.name}`, fr: `Informations du bucket ${bucket.name}`, de: `Bucket-Informationen fur ${bucket.name}` })}
                          title={t({ en: `Bucket information for ${bucket.name}`, fr: `Informations du bucket ${bucket.name}`, de: `Bucket-Informationen fur ${bucket.name}` })}
                          className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-600 shadow-sm transition hover:border-primary/60 hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-primary-200"
                        >
                          <span aria-hidden>i</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBucketPrimaryAction(bucket)}
                          aria-label={
                            canOpenBucketInBrowser
                              ? t({
                                  en: `Open bucket ${bucket.name} in Browser`,
                                  fr: `Ouvrir le bucket ${bucket.name} dans Browser`,
                                  de: `Bucket ${bucket.name} im Browser offnen`,
                                })
                              : t({
                                  en: `Open bucket details for ${bucket.name}`,
                                  fr: `Ouvrir les details du bucket ${bucket.name}`,
                                  de: `Bucket-Details fur ${bucket.name} offnen`,
                                })
                          }
                          title={
                            canOpenBucketInBrowser
                              ? t({
                                  en: `Open bucket ${bucket.name} in Browser`,
                                  fr: `Ouvrir le bucket ${bucket.name} dans Browser`,
                                  de: `Bucket ${bucket.name} im Browser offnen`,
                                })
                              : t({
                                  en: `Open bucket details for ${bucket.name}`,
                                  fr: `Ouvrir les details du bucket ${bucket.name}`,
                                  de: `Bucket-Details fur ${bucket.name} offnen`,
                                })
                          }
                          className="min-w-0 flex-1 cursor-pointer rounded-md text-left focus:outline-none focus:ring-2 focus:ring-primary/30"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900 dark:text-white" title={bucket.name}>
                              {bucket.name}
                            </div>
                            <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                              {t({ en: "Created on", fr: "Cree le", de: "Erstellt am" })}{" "}
                              {bucket.creation_date ? new Date(bucket.creation_date).toLocaleString() : "—"}
                            </p>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 ui-caption text-slate-600 dark:text-slate-300">
                            <div className="flex items-start gap-2">
                              {renderShareIndicator({
                                label: "Data",
                                percentOverride: dataShare,
                                hoverHint: t({
                                  en: "Data percentage relative to total account usage",
                                  fr: "Pourcentage Data relatif a l'utilisation totale du compte",
                                  de: "Daten-Prozentsatz relativ zur gesamten Kontonutzung",
                                }),
                              })}
                              <div className="min-w-0">
                                <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {t({ en: "Storage", fr: "Volumetrie", de: "Speicher" })}
                                </div>
                                <div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{usedLabel}</div>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              {renderShareIndicator({
                                label: t({ en: "Objects", fr: "Objets", de: "Objekte" }),
                                percentOverride: objectsShare,
                                hoverHint: t({
                                  en: "Objects percentage relative to total account usage",
                                  fr: "Pourcentage Objets relatif a l'utilisation totale du compte",
                                  de: "Objekt-Prozentsatz relativ zur gesamten Kontonutzung",
                                }),
                              })}
                              <div className="min-w-0">
                                <div className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  {t({ en: "Objects", fr: "Objets", de: "Objekte" })}
                                </div>
                                <div className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{objectsLabel}</div>
                              </div>
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>
                  );
                })
                ) : (
                  <div className="w-full">
                    <UiEmptyState
                      title={t({ en: "No result", fr: "Aucun resultat", de: "Kein Ergebnis" })}
                      description={t({ en: "No bucket matches your search.", fr: "Aucun bucket ne correspond a la recherche.", de: "Kein Bucket entspricht Ihrer Suche." })}
                    />
                  </div>
                )
              ) : (
                <div className="w-full">
                  <UiEmptyState
                    title={t({ en: "No bucket", fr: "Aucun bucket", de: "Kein Bucket" })}
                    description={t({ en: "Create a bucket to start storing objects.", fr: "Creez un bucket pour commencer a stocker des objets.", de: "Erstellen Sie einen Bucket, um Objekte zu speichern." })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
