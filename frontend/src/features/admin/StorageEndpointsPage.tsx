/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { uiCheckboxClass } from "../../components/ui/styles";
import {
  detectStorageEndpointFeatures,
  StorageEndpoint,
  StorageEndpointPayload,
  StorageProvider,
  createStorageEndpoint,
  deleteStorageEndpoint,
  fetchStorageEndpointsMeta,
  listStorageEndpoints,
  setDefaultStorageEndpoint,
  updateStorageEndpoint,
  updateStorageEndpointTags,
} from "../../api/storageEndpoints";
import Modal from "../../components/Modal";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { extractApiError } from "../../utils/apiError";
import { buildUiTagItems, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { isSuperAdminRole, readStoredUser } from "../../utils/workspaces";

type FormState = {
  name: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
  provider: StorageProvider;
  tags: UiTagDefinition[];
  admin_access_key: string;
  admin_secret_key: string;
  supervision_access_key: string;
  supervision_secret_key: string;
  ceph_admin_access_key: string;
  ceph_admin_secret_key: string;
  has_admin_secret: boolean;
  has_supervision_secret: boolean;
  features: FeaturesState;
};

type HealthcheckMode = "http" | "s3";
type FeatureKey = "admin" | "account" | "sts" | "usage" | "metrics" | "static_website" | "iam" | "sns" | "sse" | "healthcheck";

type FeatureState = {
  enabled: boolean;
  endpoint: string;
  mode?: HealthcheckMode;
};

type FeaturesState = Record<FeatureKey, FeatureState>;

const FEATURE_KEYS: FeatureKey[] = ["admin", "account", "sts", "usage", "metrics", "static_website", "iam", "sns", "sse", "healthcheck"];
const AWS_DEFAULT_REGION = "us-east-1";
const AWS_IAM_ENDPOINT = "https://iam.amazonaws.com";
const AWS_GOV_IAM_ENDPOINT = "https://iam.us-gov.amazonaws.com";
const AWS_CN_IAM_ENDPOINT = "https://iam.cn-north-1.amazonaws.com.cn";
const ADMIN_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="s3m-admin" \\',
  '  --display-name="S3 Manager Admin Ops" \\',
  '  --caps="users=read,write;accounts=read,write"',
].join("\n");

function normalizeAwsRegion(region?: string | null): string {
  const normalized = (region ?? "").trim().toLowerCase();
  return normalized || AWS_DEFAULT_REGION;
}

function awsDnsSuffixForRegion(region?: string | null): string {
  return normalizeAwsRegion(region).startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
}

function awsS3EndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  return `https://s3.${normalized}.${awsDnsSuffixForRegion(normalized)}`;
}

function awsStsEndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  return `https://sts.${normalized}.${awsDnsSuffixForRegion(normalized)}`;
}

function awsIamEndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  if (normalized.startsWith("cn-")) return AWS_CN_IAM_ENDPOINT;
  if (normalized.startsWith("us-gov-")) return AWS_GOV_IAM_ENDPOINT;
  return AWS_IAM_ENDPOINT;
}

const SUPERVISION_OPS_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="s3m-supervision" \\',
  '  --display-name="S3 Manager Supervision Ops" \\',
  '  --caps="usage=read;buckets=read"',
].join("\n");
const CEPH_ADMIN_COMMAND = [
  "radosgw-admin user create \\",
  '  --uid="s3m-ceph-admin" \\',
  '  --display-name="S3 Manager Ceph Admin" \\',
  '  --admin',
].join("\n");

function createEmptyFeatures(): FeaturesState {
  return {
    admin: { enabled: false, endpoint: "" },
    account: { enabled: false, endpoint: "" },
    sts: { enabled: false, endpoint: "" },
    usage: { enabled: false, endpoint: "" },
    metrics: { enabled: false, endpoint: "" },
    static_website: { enabled: false, endpoint: "" },
    iam: { enabled: false, endpoint: "" },
    sns: { enabled: false, endpoint: "" },
    sse: { enabled: false, endpoint: "" },
    healthcheck: { enabled: true, endpoint: "", mode: "http" },
  };
}

function defaultFeaturesForProvider(provider: StorageProvider, region = AWS_DEFAULT_REGION): FeaturesState {
  const base = createEmptyFeatures();
  if (provider === "ceph") {
    return {
      ...base,
      admin: { ...base.admin, enabled: false },
      account: { ...base.account, enabled: false },
      usage: { ...base.usage, enabled: false },
      metrics: { ...base.metrics, enabled: false },
      sts: { ...base.sts, enabled: false },
      static_website: { ...base.static_website, enabled: false },
      iam: { ...base.iam, enabled: true },
      sns: { ...base.sns, enabled: false },
      sse: { ...base.sse, enabled: false },
    };
  }
  if (provider === "aws") {
    return {
      ...base,
      sts: { ...base.sts, enabled: true, endpoint: awsStsEndpointForRegion(region) },
      static_website: { ...base.static_website, enabled: true },
      iam: { ...base.iam, enabled: true, endpoint: awsIamEndpointForRegion(region) },
      sse: { ...base.sse, enabled: true },
      healthcheck: { ...base.healthcheck, enabled: true, mode: "http" },
    };
  }
  return {
    ...base,
    sts: { ...base.sts, enabled: false },
    static_website: { ...base.static_website, enabled: false },
    iam: { ...base.iam, enabled: true },
    sse: { ...base.sse, enabled: false },
  };
}

function applyFeatureConstraints(features: FeaturesState, provider: StorageProvider): FeaturesState {
  const next: FeaturesState = {
    admin: { ...features.admin },
    account: { ...features.account },
    sts: { ...features.sts },
    usage: { ...features.usage },
    metrics: { ...features.metrics },
    static_website: { ...features.static_website },
    iam: { ...features.iam },
    sns: { ...features.sns },
    sse: { ...features.sse },
    healthcheck: { ...features.healthcheck, mode: features.healthcheck.mode === "s3" ? "s3" : "http" },
  };
  if (provider !== "ceph") {
    next.admin.enabled = false;
    next.account.enabled = false;
    next.usage.enabled = false;
    next.metrics.enabled = false;
    next.sns.enabled = false;
    next.healthcheck.mode = "http";
  }
  if (!next.admin.enabled) {
    next.account.enabled = false;
  }
  if (!next.sts.enabled) {
    next.sts.endpoint = "";
  }
  if (!next.iam.enabled) {
    next.iam.endpoint = "";
  }
  if (next.healthcheck.mode !== "s3") {
    next.healthcheck.mode = "http";
  }
  return next;
}

function buildFeaturesYaml(features: FeaturesState): string {
  const lines: string[] = ["features:"];
  FEATURE_KEYS.forEach((key) => {
    const entry = features[key];
    lines.push(`  ${key}:`);
    lines.push(`    enabled: ${entry.enabled ? "true" : "false"}`);
    if ((key === "admin" || key === "sts" || key === "iam") && entry.enabled && entry.endpoint.trim()) {
      lines.push(`    endpoint: ${entry.endpoint.trim()}`);
    }
    if (key === "healthcheck") {
      lines.push(`    mode: ${entry.mode === "s3" ? "s3" : "http"}`);
      if (entry.endpoint.trim()) {
        lines.push(`    healthcheck_url: ${entry.endpoint.trim()}`);
      }
    }
  });
  return lines.join("\n");
}

function createEmptyForm(): FormState {
  const features = defaultFeaturesForProvider("ceph");
  return {
    name: "",
    endpoint_url: "",
    region: "",
    force_path_style: false,
    verify_tls: true,
    provider: "ceph",
    tags: [],
    admin_access_key: "",
    admin_secret_key: "",
    supervision_access_key: "",
    supervision_secret_key: "",
    ceph_admin_access_key: "",
    ceph_admin_secret_key: "",
    has_admin_secret: false,
    has_supervision_secret: false,
    features,
  };
}

const EMPTY_FORM: FormState = createEmptyForm();

function createFormFromEndpoint(endpoint: StorageEndpoint): FormState {
  return {
    name: endpoint.name ?? "",
    endpoint_url: endpoint.endpoint_url ?? "",
    region: endpoint.region ?? "",
    force_path_style: Boolean(endpoint.force_path_style),
    verify_tls: endpoint.verify_tls !== false,
    provider: endpoint.provider,
    tags: normalizeUiTags(endpoint.tags),
    admin_access_key: endpoint.admin_access_key ?? "",
    admin_secret_key: "",
    supervision_access_key: endpoint.supervision_access_key ?? "",
    supervision_secret_key: "",
    ceph_admin_access_key: endpoint.ceph_admin_access_key ?? "",
    ceph_admin_secret_key: "",
    has_admin_secret: Boolean(endpoint.has_admin_secret),
    has_supervision_secret: Boolean(endpoint.has_supervision_secret),
    features: resolveFeatureState(endpoint, endpoint.provider),
  };
}

function extractError(err: unknown): string {
  return extractApiError(err, "An error occurred.");
}

function isMethodNotAllowedError(message?: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes("405") || normalized.includes("methodnotallowed") || normalized.includes("method not allowed");
}

function ProviderBadge({ provider }: { provider: StorageProvider }) {
  const classes =
    provider === "ceph"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
      : provider === "aws"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100";
  const label = provider === "ceph" ? "Ceph" : provider === "aws" ? "AWS" : "Other";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ui-caption font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}

function LockBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
      🔒 {label}
    </span>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 ui-caption font-semibold text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">
      {label}
    </span>
  );
}

function resolveCapability(endpoint: StorageEndpoint, key: string, fallback = false) {
  return endpoint.capabilities?.[key] ?? fallback;
}

function resolveFeatureState(endpoint: StorageEndpoint, provider: StorageProvider): FeaturesState {
  if (endpoint.features) {
    return applyFeatureConstraints(
      {
        admin: {
          enabled: Boolean(endpoint.features.admin?.enabled),
          endpoint: endpoint.features.admin?.endpoint ?? "",
        },
        account: {
          enabled: Boolean(endpoint.features.account?.enabled),
          endpoint: "",
        },
        sts: {
          enabled: Boolean(endpoint.features.sts?.enabled),
          endpoint: endpoint.features.sts?.endpoint ?? "",
        },
        usage: {
          enabled: Boolean(endpoint.features.usage?.enabled),
          endpoint: "",
        },
        metrics: {
          enabled: Boolean(endpoint.features.metrics?.enabled),
          endpoint: "",
        },
        static_website: {
          enabled: Boolean(endpoint.features.static_website?.enabled),
          endpoint: "",
        },
        iam: {
          enabled: Boolean(endpoint.features.iam?.enabled),
          endpoint: endpoint.features.iam?.endpoint ?? "",
        },
        sns: {
          enabled: Boolean(endpoint.features.sns?.enabled),
          endpoint: "",
        },
        sse: {
          enabled: Boolean(endpoint.features.sse?.enabled),
          endpoint: "",
        },
        healthcheck: {
          enabled: endpoint.features.healthcheck?.enabled !== false,
          endpoint: endpoint.features.healthcheck?.url ?? "",
          mode: endpoint.features.healthcheck?.mode === "s3" ? "s3" : "http",
        },
      },
      provider
    );
  }
  const fallback: FeaturesState = {
    admin: { enabled: resolveCapability(endpoint, "admin"), endpoint: endpoint.admin_endpoint ?? "" },
    account: { enabled: resolveCapability(endpoint, "account"), endpoint: "" },
    sts: { enabled: resolveCapability(endpoint, "sts"), endpoint: "" },
    usage: { enabled: resolveCapability(endpoint, "usage"), endpoint: "" },
    metrics: { enabled: resolveCapability(endpoint, "metrics"), endpoint: "" },
    static_website: { enabled: resolveCapability(endpoint, "static_website"), endpoint: "" },
    iam: { enabled: resolveCapability(endpoint, "iam"), endpoint: "" },
    sns: { enabled: resolveCapability(endpoint, "sns"), endpoint: "" },
    sse: { enabled: resolveCapability(endpoint, "sse"), endpoint: "" },
    healthcheck: { enabled: true, endpoint: "", mode: "http" },
  };
  return applyFeatureConstraints(fallback, provider);
}

export default function StorageEndpointsPage() {
  const { generalSettings } = useGeneralSettings();
  const currentUser = useMemo(() => readStoredUser(), []);
  const canEditEndpoints = isSuperAdminRole(currentUser?.role);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [envManaged, setEnvManaged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"full" | "tags_only">("full");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showOpsHelp, setShowOpsHelp] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultBusyId, setDefaultBusyId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageEndpoint | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [featureDetectBusy, setFeatureDetectBusy] = useState(false);
  const [featureDetectError, setFeatureDetectError] = useState<string | null>(null);
  const [featureDetectWarnings, setFeatureDetectWarnings] = useState<string[]>([]);
  const {
    catalog: endpointTagCatalog,
    loading: endpointTagCatalogLoading,
    error: endpointTagCatalogError,
  } = useTagCatalog({ kind: "admin", domain: "endpoint" }, Boolean(showForm && canEditEndpoints));

  const resetForm = useCallback(() => {
    setForm(createEmptyForm());
    setFormMode("full");
    setShowOpsHelp(false);
    setFormError(null);
    setFeatureDetectBusy(false);
    setFeatureDetectError(null);
    setFeatureDetectWarnings([]);
    setEditingId(null);
  }, []);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, meta] = await Promise.all([listStorageEndpoints(), fetchStorageEndpointsMeta()]);
      setEndpoints(data);
      setEnvManaged(Boolean(meta.managed_by_env));
    } catch (err) {
      setError(extractError(err));
      setEnvManaged(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  const cephMode = useMemo(() => form.provider === "ceph", [form.provider]);
  const cephAdminConfigEnabled = Boolean(generalSettings.ceph_admin_enabled);
  const defaultEndpoint = useMemo(() => endpoints.find((ep) => ep.is_default), [endpoints]);
  useEffect(() => {
    if (!showForm || !cephMode || !canEditEndpoints) {
      setFeatureDetectBusy(false);
      setFeatureDetectError(null);
      setFeatureDetectWarnings([]);
      return;
    }
    const endpointUrl = form.endpoint_url.trim();
    const adminEndpointOverride = form.features.admin.endpoint.trim();
    const adminAccessKey = form.admin_access_key.trim();
    const adminSecretKey = form.admin_secret_key.trim();
    const supervisionAccessKey = form.supervision_access_key.trim();
    const supervisionSecretKey = form.supervision_secret_key.trim();
    const hasAdminCredentials = Boolean(adminAccessKey && (adminSecretKey || form.has_admin_secret));
    const hasSupervisionCredentials = Boolean(
      supervisionAccessKey && (supervisionSecretKey || form.has_supervision_secret)
    );

    if (!endpointUrl || (!hasAdminCredentials && !hasSupervisionCredentials)) {
      setFeatureDetectBusy(false);
      setFeatureDetectError(null);
      setFeatureDetectWarnings([]);
      setForm((prev) => {
        if (prev.provider !== "ceph") return prev;
        const next = applyFeatureConstraints(
          {
            ...prev.features,
            admin: { ...prev.features.admin, enabled: false },
            account: { ...prev.features.account, enabled: false },
            usage: { ...prev.features.usage, enabled: false },
            metrics: { ...prev.features.metrics, enabled: false },
          },
          prev.provider
        );
        if (
          next.admin.enabled === prev.features.admin.enabled &&
          next.account.enabled === prev.features.account.enabled &&
          next.usage.enabled === prev.features.usage.enabled &&
          next.metrics.enabled === prev.features.metrics.enabled
        ) {
          return prev;
        }
        return { ...prev, features: next };
      });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setFeatureDetectBusy(true);
      setFeatureDetectError(null);
      try {
        const detection = await detectStorageEndpointFeatures({
          endpoint_id: editingId,
          endpoint_url: endpointUrl,
          admin_endpoint: adminEndpointOverride || null,
          region: form.region.trim() || null,
          verify_tls: form.verify_tls,
          admin_access_key: adminAccessKey || null,
          admin_secret_key: adminSecretKey || null,
          supervision_access_key: supervisionAccessKey || null,
          supervision_secret_key: supervisionSecretKey || null,
        });
        if (cancelled) return;
        const warnings: string[] = [];
        if (Array.isArray(detection.warnings)) {
          warnings.push(...detection.warnings.filter((item) => typeof item === "string" && item.trim()));
        }
        const errorParts: string[] = [];
        if (hasAdminCredentials && !detection.admin && detection.admin_error) {
          errorParts.push(`Admin: ${detection.admin_error}`);
        }
        if (hasAdminCredentials && !detection.account && detection.account_error) {
          if (isMethodNotAllowedError(detection.account_error)) {
            warnings.push("Account API is not available on this endpoint (optional capability).");
          } else {
            errorParts.push(`Account API: ${detection.account_error}`);
          }
        }
        if (hasSupervisionCredentials && !detection.metrics && detection.metrics_error) {
          errorParts.push(`Metrics: ${detection.metrics_error}`);
        }
        if (hasSupervisionCredentials && !detection.usage && detection.usage_error) {
          errorParts.push(`Usage Log: ${detection.usage_error}`);
        }
        setFeatureDetectWarnings(warnings);
        setFeatureDetectError(errorParts.length > 0 ? errorParts.join(" | ") : null);
        setForm((prev) => {
          if (prev.provider !== "ceph") return prev;
          const next = applyFeatureConstraints(
            {
              ...prev.features,
              admin: { ...prev.features.admin, enabled: Boolean(detection.admin) },
              account: { ...prev.features.account, enabled: Boolean(detection.account) },
              usage: { ...prev.features.usage, enabled: Boolean(detection.usage) },
              metrics: { ...prev.features.metrics, enabled: Boolean(detection.metrics) },
            },
            prev.provider
          );
          if (
            next.admin.enabled === prev.features.admin.enabled &&
            next.account.enabled === prev.features.account.enabled &&
            next.usage.enabled === prev.features.usage.enabled &&
            next.metrics.enabled === prev.features.metrics.enabled
          ) {
            return prev;
          }
          return { ...prev, features: next };
        });
      } catch (err) {
        if (!cancelled) {
          setFeatureDetectWarnings([]);
          setFeatureDetectError(extractError(err));
        }
      } finally {
        if (!cancelled) {
          setFeatureDetectBusy(false);
        }
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    cephMode,
    editingId,
    form.admin_access_key,
    form.admin_secret_key,
    form.endpoint_url,
    form.features.admin.endpoint,
    form.has_admin_secret,
    form.has_supervision_secret,
    form.region,
    form.verify_tls,
    form.supervision_access_key,
    form.supervision_secret_key,
    showForm,
    canEditEndpoints,
  ]);

  const awsMode = form.provider === "aws";
  const computedAwsRegion = normalizeAwsRegion(form.region);
  const computedAwsS3Endpoint = awsS3EndpointForRegion(computedAwsRegion);
  const computedAwsStsEndpoint = awsStsEndpointForRegion(computedAwsRegion);
  const computedAwsIamEndpoint = awsIamEndpointForRegion(computedAwsRegion);

  const updateFeatures = useCallback(
    (updater: (current: FeaturesState) => FeaturesState, providerOverride?: StorageProvider) => {
      setForm((prev) => {
        const provider = providerOverride ?? prev.provider;
        const nextRaw = updater(prev.features);
        const constrained = applyFeatureConstraints(nextRaw, provider);
        return {
          ...prev,
          provider,
          features: constrained,
        };
      });
    },
    []
  );

  const handleProviderChange = (provider: StorageProvider) => {
    setForm((prev) => {
      const awsRegion = AWS_DEFAULT_REGION;
      const defaultFeatures = defaultFeaturesForProvider(provider, awsRegion);
      const constrained = applyFeatureConstraints(defaultFeatures, provider);
      return {
        ...prev,
        provider,
        endpoint_url: provider === "aws" ? awsS3EndpointForRegion(awsRegion) : prev.endpoint_url,
        region: provider === "aws" ? awsRegion : prev.region,
        verify_tls: provider === "aws" ? true : prev.verify_tls,
        admin_access_key: provider === "ceph" ? prev.admin_access_key : "",
        admin_secret_key: provider === "ceph" ? prev.admin_secret_key : "",
        supervision_access_key: provider === "ceph" ? prev.supervision_access_key : "",
        supervision_secret_key: provider === "ceph" ? prev.supervision_secret_key : "",
        ceph_admin_access_key: provider === "ceph" ? prev.ceph_admin_access_key : "",
        ceph_admin_secret_key: provider === "ceph" ? prev.ceph_admin_secret_key : "",
        features: constrained,
      };
    });
  };

  const handleRegionChange = (region: string) => {
    setForm((prev) => {
      if (prev.provider !== "aws") {
        return { ...prev, region };
      }
      const nextRegion = normalizeAwsRegion(region);
      const nextFeatures = applyFeatureConstraints(
        {
          ...prev.features,
          sts: { ...prev.features.sts, endpoint: awsStsEndpointForRegion(nextRegion) },
          iam: { ...prev.features.iam, endpoint: awsIamEndpointForRegion(nextRegion) },
        },
        prev.provider
      );
      return {
        ...prev,
        region,
        endpoint_url: awsS3EndpointForRegion(nextRegion),
        features: nextFeatures,
      };
    });
  };

  const startCreate = () => {
    if (envManaged || !canEditEndpoints) return;
    resetForm();
    setFormMode("full");
    setShowForm(true);
  };

  const startEdit = (endpoint: StorageEndpoint) => {
    if (envManaged || !canEditEndpoints) return;
    setEditingId(endpoint.id);
    setFormMode("full");
    setForm(createFormFromEndpoint(endpoint));
    setFormError(null);
    setShowForm(true);
  };

  const openTagsOnly = (endpoint: StorageEndpoint) => {
    if (!canEditEndpoints) return;
    setEditingId(endpoint.id);
    setFormMode("tags_only");
    setForm(createFormFromEndpoint(endpoint));
    setFormError(null);
    setShowForm(true);
  };

  const onCloseForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (envManaged || !canEditEndpoints) return;
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteStorageEndpoint(deleteTarget.id);
      setDeleteTarget(null);
      setActionMessage("Endpoint deleted.");
      loadEndpoints();
    } catch (err) {
      setDeleteError(extractError(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleSetDefault = async (endpoint: StorageEndpoint) => {
    if (envManaged || !canEditEndpoints) return;
    if (endpoint.is_default) return;
    setDefaultError(null);
    setDefaultBusyId(endpoint.id);
    try {
      await setDefaultStorageEndpoint(endpoint.id);
      setActionMessage("Default endpoint updated.");
      loadEndpoints();
    } catch (err) {
      setDefaultError(extractError(err));
    } finally {
      setDefaultBusyId(null);
    }
  };

  const buildPayload = (): StorageEndpointPayload | null => {
    const trimmedName = form.name.trim();
    const awsPayloadRegion = normalizeAwsRegion(form.region);
    const trimmedEndpoint = form.provider === "aws" ? awsS3EndpointForRegion(awsPayloadRegion) : form.endpoint_url.trim();
    const trimmedRegion = form.provider === "aws" ? awsPayloadRegion : form.region.trim();
    const trimmedAdminAccess = form.admin_access_key.trim();
    const trimmedAdminSecret = form.admin_secret_key.trim();
    const trimmedSupervisionAccess = form.supervision_access_key.trim();
    const trimmedSupervisionSecret = form.supervision_secret_key.trim();
    const trimmedCephAdminAccess = form.ceph_admin_access_key.trim();
    const trimmedCephAdminSecret = form.ceph_admin_secret_key.trim();
    const featuresSource =
      form.provider === "aws"
        ? {
            ...form.features,
            sts: { ...form.features.sts, endpoint: awsStsEndpointForRegion(awsPayloadRegion) },
            iam: { ...form.features.iam, endpoint: awsIamEndpointForRegion(awsPayloadRegion) },
          }
        : form.features;
    const constrainedFeatures = applyFeatureConstraints(featuresSource, form.provider);
    const featuresConfig = buildFeaturesYaml(constrainedFeatures);
    const adminEnabled = constrainedFeatures.admin.enabled;
    const usageMetricsEnabled = constrainedFeatures.usage.enabled || constrainedFeatures.metrics.enabled;

    if (!trimmedName) {
      setFormError("Storage name is required.");
      return null;
    }
    if (!trimmedEndpoint) {
      setFormError("Endpoint URL is required.");
      return null;
    }

    const payload: StorageEndpointPayload = {
      name: trimmedName,
      endpoint_url: trimmedEndpoint,
      region: trimmedRegion || null,
      force_path_style: Boolean(form.force_path_style),
      verify_tls: Boolean(form.verify_tls),
      provider: form.provider,
      features_config: featuresConfig,
    };

    if (form.provider === "ceph") {
      if (adminEnabled && !trimmedAdminAccess) {
        setFormError("Admin access key is required when admin is enabled.");
        return null;
      }
      if (usageMetricsEnabled && !trimmedSupervisionAccess) {
        setFormError("Supervision access key is required when usage log or metrics is enabled.");
        return null;
      }
      if (editingId) {
        if (trimmedAdminAccess) {
          payload.admin_access_key = trimmedAdminAccess;
          if (trimmedAdminSecret) payload.admin_secret_key = trimmedAdminSecret;
        } else {
          payload.admin_access_key = null;
          payload.admin_secret_key = null;
        }
        if (trimmedSupervisionAccess) {
          payload.supervision_access_key = trimmedSupervisionAccess;
          if (trimmedSupervisionSecret) payload.supervision_secret_key = trimmedSupervisionSecret;
        } else {
          payload.supervision_access_key = null;
          payload.supervision_secret_key = null;
        }
        if (trimmedCephAdminAccess) {
          payload.ceph_admin_access_key = trimmedCephAdminAccess;
          if (trimmedCephAdminSecret) payload.ceph_admin_secret_key = trimmedCephAdminSecret;
        } else {
          payload.ceph_admin_access_key = null;
          payload.ceph_admin_secret_key = null;
        }
      } else {
        payload.admin_access_key = trimmedAdminAccess || null;
        payload.admin_secret_key = trimmedAdminSecret || null;
        payload.supervision_access_key = trimmedSupervisionAccess || null;
        payload.supervision_secret_key = trimmedSupervisionSecret || null;
        payload.ceph_admin_access_key = trimmedCephAdminAccess || null;
        payload.ceph_admin_secret_key = trimmedCephAdminSecret || null;
        if (adminEnabled && (!payload.admin_access_key || !payload.admin_secret_key)) {
          setFormError("Admin credentials are required for a Ceph endpoint.");
          return null;
        }
        if (usageMetricsEnabled && (!payload.supervision_access_key || !payload.supervision_secret_key)) {
          setFormError("Supervision credentials are required for usage log/metrics on a Ceph endpoint.");
          return null;
        }
      }
    }

    return payload;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditEndpoints) return;
    setFormError(null);
    setSaving(true);
    try {
      const normalizedTags = normalizeUiTags(form.tags);
      if (editingId) {
        if (formMode === "full") {
          const payload = buildPayload();
          if (!payload) {
            setSaving(false);
            return;
          }
          await updateStorageEndpoint(editingId, payload);
        }
        await updateStorageEndpointTags(editingId, { tags: normalizedTags });
        setActionMessage(formMode === "tags_only" ? "Endpoint tags updated." : "Endpoint updated.");
      } else {
        if (envManaged) return;
        const payload = buildPayload();
        if (!payload) {
          setSaving(false);
          return;
        }
        const created = await createStorageEndpoint(payload);
        if (normalizedTags.length > 0) {
          await updateStorageEndpointTags(created.id, { tags: normalizedTags });
        }
        setActionMessage("Endpoint added.");
      }
      setShowForm(false);
      resetForm();
      await loadEndpoints();
    } catch (err) {
      setFormError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const renderEndpointCard = (endpoint: StorageEndpoint) => {
    const showSupervision = endpoint.supervision_access_key || endpoint.has_supervision_secret;
    const showCephAdmin = endpoint.ceph_admin_access_key || endpoint.has_ceph_admin_secret;
    const tagItems = buildUiTagItems(endpoint.tags);
    const verifyTls = endpoint.verify_tls !== false;
    const forcePathStyle = Boolean(endpoint.force_path_style);
    const features = resolveFeatureState(endpoint, endpoint.provider);
    const adminEnabled = features.admin.enabled;
    const stsEnabled = features.sts.enabled;
    const usageEnabled = features.usage.enabled;
    const metricsEnabled = features.metrics.enabled;
    const accountEnabled = features.account.enabled;
    const staticWebsiteEnabled = features.static_website.enabled;
    const iamEnabled = features.iam.enabled;
    const snsEnabled = features.sns.enabled;
    const sseEnabled = features.sse.enabled;
    const healthcheckMode = features.healthcheck.mode === "s3" ? "s3" : "http";
    const healthcheckUrl = features.healthcheck.endpoint.trim();
    const settingDefault = defaultBusyId === endpoint.id;
    const adminEndpointOverride = features.admin.endpoint.trim();
    const stsEndpointOverride = features.sts.endpoint.trim();
    const iamEndpointOverride = features.iam.endpoint.trim();
    const showAdminEndpoint =
      adminEnabled &&
      Boolean(adminEndpointOverride) &&
      adminEndpointOverride !== endpoint.endpoint_url;
    const showStsEndpoint =
      stsEnabled &&
      Boolean(stsEndpointOverride) &&
      stsEndpointOverride !== endpoint.endpoint_url;
    const showIamEndpoint =
      iamEnabled &&
      Boolean(iamEndpointOverride) &&
      iamEndpointOverride !== endpoint.endpoint_url;
    const readOnly = envManaged || !endpoint.is_editable || !canEditEndpoints;

    return (
      <div
        key={endpoint.id}
        className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/70 ui-body"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <h3 className="ui-section font-semibold text-slate-900 dark:text-white">{endpoint.name}</h3>
                <ProviderBadge provider={endpoint.provider} />
                {endpoint.is_default && <StatusBadge label="Default" />}
                {envManaged && <LockBadge label="Env managed" />}
                {!envManaged && !endpoint.is_editable && <LockBadge label="Protected" />}
              </div>
              {tagItems.length > 0 && (
                <UiTagBadgeList
                  items={tagItems}
                  variant="listing-compact"
                  layout="inline-compact"
                  className="ml-auto max-w-full"
                  maxVisible={6}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-100">Endpoint:</span>
              <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {endpoint.endpoint_url}
              </code>
            </div>
            {showAdminEndpoint && (
              <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">Admin endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {adminEndpointOverride}
                </code>
              </div>
            )}
            {showStsEndpoint && (
              <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">STS endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {stsEndpointOverride}
                </code>
              </div>
            )}
            {showIamEndpoint && (
              <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-700 dark:text-slate-100">IAM endpoint:</span>
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {iamEndpointOverride}
                </code>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 ui-body text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-100">Healthcheck:</span>
              <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                {healthcheckMode.toUpperCase()}
              </code>
              {healthcheckUrl && (
                <code className="rounded bg-slate-100 px-2 py-1 ui-caption text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                  {healthcheckUrl}
                </code>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!endpoint.is_default && (
              <button
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                onClick={() => handleSetDefault(endpoint)}
                type="button"
                disabled={Boolean(defaultBusyId) || envManaged || !canEditEndpoints}
              >
                {settingDefault ? "Setting..." : "Set as default"}
              </button>
            )}
            {!readOnly ? (
              <>
                <button
                  className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                  onClick={() => startEdit(endpoint)}
                  type="button"
                >
                  Edit
                </button>
                <button
                  className="rounded-md bg-rose-600 px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-rose-700"
                  onClick={() => {
                    setDeleteTarget(endpoint);
                    setDeleteError(null);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                {canEditEndpoints && (
                  <button
                    className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                    onClick={() => openTagsOnly(endpoint)}
                    type="button"
                  >
                    Edit tags
                  </button>
                )}
                <span className="ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {canEditEndpoints ? "Config read-only" : "Read-only"}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Region</p>
            <p className="font-semibold">{endpoint.region || "Default"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">TLS verification</p>
            <p className={`font-semibold ${verifyTls ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
              {verifyTls ? "Enabled" : "Disabled (insecure)"}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Path style</p>
            <p className="font-semibold">{forcePathStyle ? "Forced" : "Virtual-host style"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Admin key</p>
            {endpoint.provider === "ceph" ? (
              <p className="font-semibold">
                {endpoint.admin_access_key ? endpoint.admin_access_key : "Not configured"}
                {endpoint.has_admin_secret && <span className="ml-2 ui-caption text-emerald-500">(secret stored)</span>}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not required</p>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Supervision</p>
            {showSupervision ? (
              <p className="font-semibold">
                {endpoint.supervision_access_key || "—"}
                {endpoint.has_supervision_secret && (
                  <span className="ml-2 ui-caption text-emerald-500">(secret stored)</span>
                )}
              </p>
            ) : (
              <p className="font-semibold text-slate-500">Not set</p>
            )}
          </div>
          {endpoint.provider === "ceph" && cephAdminConfigEnabled && (
            <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
              <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Ceph Admin dedicated key
              </p>
              {showCephAdmin ? (
                <p className="font-semibold">
                  {endpoint.ceph_admin_access_key || "—"}
                  {endpoint.has_ceph_admin_secret && (
                    <span className="ml-2 ui-caption text-emerald-500">(secret stored)</span>
                  )}
                </p>
              ) : (
                <p className="font-semibold text-slate-500">Not set</p>
              )}
            </div>
          )}
          <div className="rounded-xl bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-inner dark:bg-slate-800 dark:text-slate-100">
            <p className="ui-caption uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
            <div className="mt-1 flex flex-wrap gap-2 ui-caption font-semibold">
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  adminEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Admin {adminEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  accountEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Account API {accountEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  usageEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Usage Log {usageEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  metricsEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Metrics {metricsEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  snsEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                SNS {snsEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  stsEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                STS {stsEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  staticWebsiteEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                Static website {staticWebsiteEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  iamEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                IAM {iamEnabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${
                  sseEnabled
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}
              >
                SSE {sseEnabled ? "on" : "off"}
              </span>
              <span className="rounded-full bg-sky-100 px-2 py-0.5 ui-caption font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-100">
                Check mode {healthcheckMode.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const showUsageLogUnavailableWarning =
    cephMode &&
    !featureDetectBusy &&
    !featureDetectError &&
    Boolean(form.endpoint_url.trim()) &&
    Boolean(form.supervision_access_key.trim() || form.has_supervision_secret) &&
    !form.features.usage.enabled;
  const hasSupervisionCredentialsForSignedProbe = Boolean(
    form.supervision_access_key.trim() && (form.supervision_secret_key.trim() || form.has_supervision_secret)
  );
  const tagsOnlyMode = formMode === "tags_only";
  const signedProbeBlockedReason = !cephMode
    ? "S3 signed probe is available only for Ceph endpoints."
    : !hasSupervisionCredentialsForSignedProbe
    ? "S3 signed probe requires Supervision credentials (access key + secret key)."
    : null;

  useEffect(() => {
    if (signedProbeBlockedReason && form.features.healthcheck.mode === "s3") {
      updateFeatures((current) => ({
        ...current,
        healthcheck: {
          ...current.healthcheck,
          mode: "http",
        },
      }));
    }
  }, [form.features.healthcheck.mode, signedProbeBlockedReason, updateFeatures]);

  return (
    <div className="space-y-4 ui-caption leading-relaxed">
      <PageHeader
        title="Storage endpoints"
        description="Manage the S3/Ceph endpoints used by the console."
        breadcrumbs={[{ label: "Admin" }, { label: "Endpoints" }]}
        actions={envManaged || !canEditEndpoints ? [] : [{ label: "New endpoint", onClick: startCreate }]}
        inlineContent={
          endpoints.length > 0 ? (
            <span className="ui-body font-semibold text-slate-500 dark:text-slate-300">
              Default endpoint: {defaultEndpoint ? defaultEndpoint.name : "None"}
            </span>
          ) : null
        }
      />

      {envManaged && (
        <PageBanner tone="info">
          Storage endpoints are managed by environment variables (ENV_STORAGE_ENDPOINTS). Configuration changes are disabled.
        </PageBanner>
      )}
      {!envManaged && !canEditEndpoints && (
        <PageBanner tone="info">
          Endpoint editing is restricted to superadmin users. You currently have read-only access.
        </PageBanner>
      )}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {defaultError && <PageBanner tone="error">{defaultError}</PageBanner>}
      {actionMessage && <PageBanner tone="success">{actionMessage}</PageBanner>}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 px-5 py-6 ui-body text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          Loading endpoints...
        </div>
      ) : endpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center ui-body text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          No endpoints configured yet.
        </div>
      ) : (
        <div className="grid gap-4">{endpoints.map((ep) => renderEndpointCard(ep))}</div>
      )}

      {showForm && (
        <Modal title={editingId ? (tagsOnlyMode ? "Edit endpoint tags" : "Edit endpoint") : "New endpoint"} onClose={onCloseForm}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            {tagsOnlyMode && (
              <PageBanner tone="info">
                Endpoint configuration is read-only in this view. You can still update the tags associated with this endpoint.
              </PageBanner>
            )}
            {endpointTagCatalogError && <PageBanner tone="warning">{endpointTagCatalogError}</PageBanner>}
            <UiTagEditor
              label="Endpoint tags"
              tags={form.tags}
              catalog={endpointTagCatalog}
              onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
              placeholder="Add a tag for this endpoint"
              hint={
                endpointTagCatalogLoading
                  ? "Loading existing endpoint tags..."
                  : "Endpoint tags can be shown in endpoint and context selectors when users enable the preference."
              }
            />
            <fieldset disabled={tagsOnlyMode} className={tagsOnlyMode ? "space-y-4 opacity-70" : "space-y-4"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Storage name
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  required
                />
              </label>
              <div className="space-y-2">
                <span className="ui-body font-semibold text-slate-700 dark:text-slate-100">Type</span>
                <div className="flex gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="ceph"
                      checked={form.provider === "ceph"}
                      onChange={() => handleProviderChange("ceph")}
                    />
                    <span>Ceph</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="aws"
                      checked={form.provider === "aws"}
                      onChange={() => handleProviderChange("aws")}
                    />
                    <span>AWS</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100">
                    <input
                      type="radio"
                      name="provider"
                      value="other"
                      checked={form.provider === "other"}
                      onChange={() => handleProviderChange("other")}
                    />
                    <span>Other</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Endpoint S3
                <input
                  type="text"
                  value={awsMode ? computedAwsS3Endpoint : form.endpoint_url}
                  onChange={(e) => {
                    if (!awsMode) {
                      setForm((prev) => ({ ...prev, endpoint_url: e.target.value }));
                    }
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary read-only:bg-slate-100 read-only:text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:read-only:bg-slate-900 dark:read-only:text-slate-300"
                  placeholder={awsMode ? computedAwsS3Endpoint : "https://s3.example.com"}
                  readOnly={awsMode}
                  required
                />
              </label>
              <label className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Region (optional)
                <input
                  type="text"
                  value={form.region}
                  onChange={(e) => handleRegionChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  placeholder="us-east-1"
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
              <label className="flex items-center justify-between gap-4 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Force path style
                <input
                  type="checkbox"
                  checked={form.force_path_style}
                  onChange={(e) => setForm((prev) => ({ ...prev, force_path_style: e.target.checked }))}
                  className={uiCheckboxClass}
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
              <label className="flex items-center justify-between gap-4 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Insecure SSL (skip certificate validation)
                <input
                  type="checkbox"
                  checked={!form.verify_tls}
                  onChange={(e) => setForm((prev) => ({ ...prev, verify_tls: !e.target.checked }))}
                  className={uiCheckboxClass}
                />
              </label>
              {!form.verify_tls && (
                <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                  TLS certificate validation is disabled for this endpoint. Use only in trusted environments.
                </p>
              )}
            </div>

            {cephMode && (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Management</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                      Admin Ops
                      <div className="grid gap-3">
                        <input
                          type="text"
                          value={form.admin_access_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, admin_access_key: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          placeholder="Access key admin"
                          required={form.features.admin.enabled}
                        />
                        <input
                          type="password"
                          value={form.admin_secret_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, admin_secret_key: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          placeholder={editingId ? "Secret key admin (leave blank to keep)" : "Secret key admin"}
                          required={!editingId && form.features.admin.enabled}
                        />
                      </div>
                      <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                        {editingId ? "Leave the secret key empty to keep the current one." : "Required when admin is enabled."}
                      </p>
                    </div>
                    <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                      Supervision Ops
                      <div className="grid gap-3">
                        <input
                          type="text"
                          value={form.supervision_access_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, supervision_access_key: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          placeholder="Access key supervision"
                          required={form.features.usage.enabled || form.features.metrics.enabled}
                        />
                        <input
                          type="password"
                          value={form.supervision_secret_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, supervision_secret_key: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          placeholder="Secret key supervision"
                          required={!editingId && (form.features.usage.enabled || form.features.metrics.enabled)}
                        />
                      </div>
                      <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                        Use these keys for read-only monitoring actions.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-caption text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <div className="flex items-center justify-between gap-2">
                    <p className="ui-body font-semibold text-slate-700 dark:text-slate-100">
                      What are Admin Ops and Supervision Ops?
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowOpsHelp((prev) => !prev)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-200"
                    >
                      {showOpsHelp ? "Hide" : "Show"}
                    </button>
                  </div>
                  {showOpsHelp && (
                    <>
                      <p className="mt-2">
                        <span className="font-semibold">Admin Ops</span> keys let S3-Manager create RGW accounts and S3 users. If you do not
                        provide Admin Ops keys, you must create accounts/users outside of S3-Manager and import them manually (or
                        via the API).
                      </p>
                      <p className="mt-2">
                        <span className="font-semibold">Supervision Ops</span> keys are read-only credentials used for usage logs and metrics
                        collection.
                      </p>
                      <p className="mt-3 font-semibold text-slate-700 dark:text-slate-100">Ceph (radosgw-admin) examples</p>
                      <div className="mt-2 space-y-3">
                        <div>
                          <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Admin Ops</p>
                          <pre className="overflow-x-auto whitespace-pre rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                            {ADMIN_OPS_COMMAND}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 font-semibold text-slate-600 dark:text-slate-300">Supervision Ops</p>
                          <pre className="overflow-x-auto whitespace-pre rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                            {SUPERVISION_OPS_COMMAND}
                          </pre>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {cephAdminConfigEnabled && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-caption text-amber-900 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
                    <p className="ui-body font-semibold">Ceph Admin dedicated credentials</p>
                    <p className="mt-2">
                      These credentials are used only by the <code>/ceph-admin</code> workspace (advanced
                      cluster-wide operations). They are isolated from Admin Ops credentials.
                    </p>
                    <p className="mt-1 ui-caption opacity-80">
                      Note: access to <code>/ceph-admin</code> uses these dedicated credentials and does not depend on the
                      <code> admin.enabled</code> endpoint feature flag.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={form.ceph_admin_access_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, ceph_admin_access_key: e.target.value }))}
                        className="w-full rounded-lg border border-amber-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-amber-900/40 dark:bg-slate-800 dark:text-slate-100"
                        placeholder="Ceph Admin access key"
                      />
                      <input
                        type="password"
                        value={form.ceph_admin_secret_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, ceph_admin_secret_key: e.target.value }))}
                        className="w-full rounded-lg border border-amber-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-amber-900/40 dark:bg-slate-800 dark:text-slate-100"
                        placeholder={editingId ? "Ceph Admin secret key (leave blank to keep)" : "Ceph Admin secret key"}
                      />
                    </div>
                    <p className="mt-2">
                      {editingId
                        ? "Leave the secret key empty to keep the current one."
                        : "Recommended: keep this account dedicated to ceph-admin only."}
                    </p>
                    <p className="mt-3 font-semibold text-amber-900 dark:text-amber-100">Ceph (radosgw-admin) example</p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                      {CEPH_ADMIN_COMMAND}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Features</p>
                <div className="mt-3 space-y-4">
                  {cephMode && (
                    <div className="space-y-3">
                      <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ceph</p>
                      {(featureDetectBusy ||
                        featureDetectError ||
                        featureDetectWarnings.length > 0 ||
                        showUsageLogUnavailableWarning) && (
                        <div className="space-y-2">
                          {featureDetectBusy && (
                            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 ui-caption text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-100">
                              Feature detection in progress from entered credentials.
                            </p>
                          )}
                          {featureDetectError && (
                            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 ui-caption text-red-900 dark:border-red-900/40 dark:bg-red-950/50 dark:text-red-100">
                              {featureDetectError}
                            </p>
                          )}
                          {featureDetectWarnings.map((warning, idx) => (
                            <p
                              key={`${warning}-${idx}`}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100"
                            >
                              {warning}
                            </p>
                          ))}
                          {showUsageLogUnavailableWarning && (
                              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
                                Usage Log does not seem enabled on RGW (`rgw_enable_usage_log`), so activity stats will not be populated.
                              </p>
                            )}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          Admin enabled
                          <input
                            type="checkbox"
                            checked={form.features.admin.enabled}
                            readOnly
                            className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          Accounts enabled
                          <input
                            type="checkbox"
                            checked={form.features.account.enabled}
                            readOnly
                            className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          Usage Log enabled
                          <input
                            type="checkbox"
                            checked={form.features.usage.enabled}
                            readOnly
                            className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          Metrics enabled
                          <input
                            type="checkbox"
                            checked={form.features.metrics.enabled}
                            readOnly
                            className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                            disabled
                          />
                        </label>
                        <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                          SNS topics enabled
                          <input
                            type="checkbox"
                            checked={form.features.sns.enabled}
                            onChange={(e) =>
                              updateFeatures((current) => ({
                                ...current,
                                sns: { ...current.sns, enabled: e.target.checked },
                              }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-50 dark:border-slate-600"
                            disabled={!cephMode}
                          />
                        </label>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                          Ceph admin endpoint override (optional)
                          <input
                            type="text"
                            value={form.features.admin.endpoint}
                            onChange={(e) =>
                              updateFeatures((current) => ({
                                ...current,
                                admin: { ...current.admin, endpoint: e.target.value },
                              }))
                            }
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            placeholder="http://rgw-admin.local"
                          />
                        </label>
                      </div>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Admin, account API, usage log, and metrics are auto-detected from credentials. Usage log/metrics require supervision credentials.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">S3</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        STS enabled
                        <input
                          type="checkbox"
                          checked={form.features.sts.enabled}
                          onChange={(e) =>
                            updateFeatures((current) => ({
                              ...current,
                              sts: { ...current.sts, enabled: e.target.checked },
                            }))
                          }
                          className={uiCheckboxClass}
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        Static website enabled
                        <input
                          type="checkbox"
                          checked={form.features.static_website.enabled}
                          onChange={(e) =>
                            updateFeatures((current) => ({
                              ...current,
                              static_website: { ...current.static_website, enabled: e.target.checked },
                            }))
                          }
                          className={uiCheckboxClass}
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        IAM enabled
                        <input
                          type="checkbox"
                          checked={form.features.iam.enabled}
                          onChange={(e) =>
                            updateFeatures((current) => ({
                              ...current,
                              iam: { ...current.iam, enabled: e.target.checked },
                            }))
                          }
                          className={uiCheckboxClass}
                        />
                      </label>
                      <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        Server-Side Encryption (SSE) enabled
                        <input
                          type="checkbox"
                          checked={form.features.sse.enabled}
                          onChange={(e) =>
                            updateFeatures((current) => ({
                              ...current,
                              sse: { ...current.sse, enabled: e.target.checked },
                            }))
                          }
                          className={uiCheckboxClass}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    {awsMode ? "STS endpoint" : "STS endpoint override (optional)"}
                    <input
                      type="text"
                      value={awsMode ? computedAwsStsEndpoint : form.features.sts.endpoint}
                      onChange={(e) => {
                        if (!awsMode) {
                          updateFeatures((current) => ({
                            ...current,
                            sts: { ...current.sts, endpoint: e.target.value },
                          }));
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary read-only:bg-slate-100 read-only:text-slate-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:read-only:bg-slate-900 dark:read-only:text-slate-300"
                      placeholder={awsMode ? computedAwsStsEndpoint : "https://sts.example.com"}
                      disabled={!form.features.sts.enabled}
                      readOnly={awsMode}
                      title={!form.features.sts.enabled ? "Enable STS first to define a dedicated STS endpoint." : undefined}
                    />
                  </label>
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    {awsMode ? "IAM endpoint" : "IAM endpoint override (optional)"}
                    <input
                      type="text"
                      value={awsMode ? computedAwsIamEndpoint : form.features.iam.endpoint}
                      onChange={(e) => {
                        if (!awsMode) {
                          updateFeatures((current) => ({
                            ...current,
                            iam: { ...current.iam, endpoint: e.target.value },
                          }));
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary read-only:bg-slate-100 read-only:text-slate-600 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:read-only:bg-slate-900 dark:read-only:text-slate-300"
                      placeholder={awsMode ? computedAwsIamEndpoint : "https://iam.example.com"}
                      disabled={!form.features.iam.enabled}
                      readOnly={awsMode}
                      title={!form.features.iam.enabled ? "Enable IAM first to define a dedicated IAM endpoint." : undefined}
                    />
                  </label>
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100">
                    Healthcheck mode
                    <select
                      value={form.features.healthcheck.mode ?? "http"}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          healthcheck: {
                            ...current.healthcheck,
                            mode: e.target.value === "s3" ? "s3" : "http",
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      disabled={!cephMode}
                      title={!cephMode ? "Healthcheck signed mode is available only for Ceph endpoints." : signedProbeBlockedReason ?? undefined}
                    >
                      <option value="http">HTTP probe</option>
                      <option value="s3" disabled={Boolean(signedProbeBlockedReason)} title={signedProbeBlockedReason ?? undefined}>
                        S3 signed probe{signedProbeBlockedReason ? " (requires supervision credentials)" : ""}
                      </option>
                    </select>
                  </label>
                  <label className="space-y-1 ui-caption font-semibold text-slate-700 dark:text-slate-100 sm:col-span-2">
                    Healthcheck URL override (optional)
                    <input
                      type="text"
                      value={form.features.healthcheck.endpoint}
                      onChange={(e) =>
                        updateFeatures((current) => ({
                          ...current,
                          healthcheck: { ...current.healthcheck, endpoint: e.target.value },
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 ui-body font-normal text-slate-900 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      placeholder="https://rgw.example.com/healthz"
                    />
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Empty value uses the endpoint URL. S3 mode signs a lightweight request with endpoint credentials.
                    </p>
                  </label>
                </div>
              </div>

            </div>
            </fieldset>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onCloseForm}
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                title={saving ? "Save in progress." : undefined}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : editingId ? (tagsOnlyMode ? "Save tags" : "Update") : "Create"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete endpoint" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body text-slate-700 dark:text-slate-100">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteBusy}
                className="rounded-md bg-rose-600 px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-70"
                type="button"
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
