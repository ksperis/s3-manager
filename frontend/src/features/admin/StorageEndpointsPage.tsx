/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cx, uiCheckboxClass } from "../../components/ui/styles";
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
import WorkflowPage, { WorkflowActions, WorkflowSection } from "../../components/WorkflowPage";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import { adminPageBreadcrumbs } from "./adminBreadcrumbs";
import PageBanner from "../../components/PageBanner";
import ListPageSection from "../../components/list/ListPageSection";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { tableActionButtonClasses, tableDeleteActionClasses } from "../../components/tableActionClasses";
import UiTagBadgeList from "../../components/UiTagBadgeList";
import UiTagEditor from "../../components/UiTagEditor";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { useTagCatalog } from "../../hooks/useTagCatalog";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { extractApiError } from "../../utils/apiError";
import { stableSignature } from "../../utils/stableSignature";
import { buildUiTagItems, normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import { isSuperAdminRole, readStoredUser } from "../../utils/workspaces";

type FormState = {
  name: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
  latitude: string;
  longitude: string;
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

type EndpointEditorTab = "general" | "credentials" | "capabilities";

type HealthcheckMode = "http" | "s3";
type FeatureKey =
  | "admin"
  | "account"
  | "sts"
  | "usage"
  | "metrics"
  | "static_website"
  | "iam"
  | "sns"
  | "sse"
  | "replication"
  | "healthcheck";

type FeatureState = {
  enabled: boolean;
  endpoint: string;
  mode?: HealthcheckMode;
};

type FeaturesState = Record<FeatureKey, FeatureState>;

const FEATURE_KEYS: FeatureKey[] = [
  "admin",
  "account",
  "sts",
  "usage",
  "metrics",
  "static_website",
  "iam",
  "sns",
  "sse",
  "replication",
  "healthcheck",
];
const ENDPOINT_LIST_FEATURES: Array<{ key: FeatureKey; label: string }> = [
  { key: "admin", label: "Admin" },
  { key: "account", label: "Account API" },
  { key: "usage", label: "Usage Log" },
  { key: "metrics", label: "Metrics" },
  { key: "sns", label: "SNS" },
  { key: "sts", label: "STS" },
  { key: "static_website", label: "Static website" },
  { key: "iam", label: "IAM" },
  { key: "sse", label: "SSE" },
  { key: "replication", label: "Replication" },
  { key: "healthcheck", label: "Healthcheck" },
];
const AWS_DEFAULT_REGION = "us-east-1";
const AWS_IAM_ENDPOINT = "https://iam.amazonaws.com";
const AWS_GOV_IAM_ENDPOINT = "https://iam.us-gov.amazonaws.com";
const AWS_CN_IAM_ENDPOINT = "https://iam.cn-north-1.amazonaws.com.cn";
const AWS_REGION_COORDINATES: Record<string, { latitude: string; longitude: string }> = {
  "af-south-1": { latitude: "-33.9249", longitude: "18.4241" },
  "ap-east-1": { latitude: "22.3193", longitude: "114.1694" },
  "ap-east-2": { latitude: "25.0330", longitude: "121.5654" },
  "ap-northeast-1": { latitude: "35.6762", longitude: "139.6503" },
  "ap-northeast-2": { latitude: "37.5665", longitude: "126.9780" },
  "ap-northeast-3": { latitude: "34.6937", longitude: "135.5023" },
  "ap-south-1": { latitude: "19.0760", longitude: "72.8777" },
  "ap-south-2": { latitude: "17.3850", longitude: "78.4867" },
  "ap-southeast-1": { latitude: "1.3521", longitude: "103.8198" },
  "ap-southeast-2": { latitude: "-33.8688", longitude: "151.2093" },
  "ap-southeast-3": { latitude: "-6.2088", longitude: "106.8456" },
  "ap-southeast-4": { latitude: "-37.8136", longitude: "144.9631" },
  "ap-southeast-5": { latitude: "3.1390", longitude: "101.6869" },
  "ap-southeast-6": { latitude: "43.5321", longitude: "172.6362" },
  "ap-southeast-7": { latitude: "13.7563", longitude: "100.5018" },
  "ca-central-1": { latitude: "45.5017", longitude: "-73.5673" },
  "ca-west-1": { latitude: "51.0447", longitude: "-114.0719" },
  "cn-north-1": { latitude: "39.9042", longitude: "116.4074" },
  "cn-northwest-1": { latitude: "38.4872", longitude: "106.2309" },
  "eu-central-1": { latitude: "50.1109", longitude: "8.6821" },
  "eu-central-2": { latitude: "47.3769", longitude: "8.5417" },
  "eu-north-1": { latitude: "59.3293", longitude: "18.0686" },
  "eu-south-1": { latitude: "45.4642", longitude: "9.1900" },
  "eu-south-2": { latitude: "40.4168", longitude: "-3.7038" },
  "eu-west-1": { latitude: "53.3498", longitude: "-6.2603" },
  "eu-west-2": { latitude: "51.5074", longitude: "-0.1278" },
  "eu-west-3": { latitude: "48.8566", longitude: "2.3522" },
  "il-central-1": { latitude: "32.0853", longitude: "34.7818" },
  "me-central-1": { latitude: "25.2048", longitude: "55.2708" },
  "me-south-1": { latitude: "26.2235", longitude: "50.5876" },
  "mx-central-1": { latitude: "19.4326", longitude: "-99.1332" },
  "sa-east-1": { latitude: "-23.5558", longitude: "-46.6396" },
  "us-east-1": { latitude: "39.0438", longitude: "-77.4874" },
  "us-east-2": { latitude: "39.9612", longitude: "-82.9988" },
  "us-gov-east-1": { latitude: "39.0438", longitude: "-77.4874" },
  "us-gov-west-1": { latitude: "37.3382", longitude: "-121.8863" },
  "us-west-1": { latitude: "37.3382", longitude: "-121.8863" },
  "us-west-2": { latitude: "45.5152", longitude: "-122.6784" },
};

const endpointInlineCodeClass =
  "rounded bg-[var(--ui-surface-muted)] px-2 py-1 ui-caption text-[var(--ui-text)]";
const endpointToggleCardClass =
  "flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const endpointToggleCardDisabledClass = cx(endpointToggleCardClass, "opacity-70");
const endpointToggleCheckboxClass = cx(uiCheckboxClass, "disabled:cursor-not-allowed disabled:opacity-50");
const endpointReadOnlyInputClass =
  "read-only:bg-slate-100 read-only:text-slate-600 dark:read-only:bg-slate-900 dark:read-only:text-slate-300";
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

function awsCoordinatesForRegion(region?: string | null): { latitude: string; longitude: string } | null {
  return AWS_REGION_COORDINATES[normalizeAwsRegion(region)] ?? null;
}

function formatCoordinateInput(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseCoordinateInput(value: string, label: string, min: number, max: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  }
  return parsed;
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
    replication: { enabled: false, endpoint: "" },
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
      replication: { ...base.replication, enabled: false },
    };
  }
  if (provider === "aws") {
    return {
      ...base,
      sts: { ...base.sts, enabled: true, endpoint: awsStsEndpointForRegion(region) },
      static_website: { ...base.static_website, enabled: true },
      iam: { ...base.iam, enabled: true, endpoint: awsIamEndpointForRegion(region) },
      sse: { ...base.sse, enabled: true },
      replication: { ...base.replication, enabled: false },
      healthcheck: { ...base.healthcheck, enabled: true, mode: "http" },
    };
  }
  return {
    ...base,
    sts: { ...base.sts, enabled: false },
    static_website: { ...base.static_website, enabled: false },
    iam: { ...base.iam, enabled: true },
    sse: { ...base.sse, enabled: false },
    replication: { ...base.replication, enabled: false },
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
    replication: { ...features.replication },
    healthcheck: { ...features.healthcheck, mode: features.healthcheck.mode === "s3" ? "s3" : "http" },
  };
  if (provider !== "ceph") {
    next.admin.enabled = false;
    next.account.enabled = false;
    next.usage.enabled = false;
    next.metrics.enabled = false;
    next.sns.enabled = false;
    next.replication.enabled = false;
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
    latitude: "",
    longitude: "",
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
    latitude: formatCoordinateInput(endpoint.latitude),
    longitude: formatCoordinateInput(endpoint.longitude),
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

function FeatureBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={cx(
        "rounded-full px-2 py-0.5 ui-caption font-semibold",
        enabled
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      )}
    >
      {label} {enabled ? "on" : "off"}
    </span>
  );
}

function CredentialSummary({
  accessKey,
  hasSecret,
  emptyLabel = "Not set",
}: {
  accessKey?: string | null;
  hasSecret?: boolean;
  emptyLabel?: string;
}) {
  if (!accessKey && !hasSecret) {
    return <span className="font-semibold text-slate-500 dark:text-slate-400">{emptyLabel}</span>;
  }
  return (
    <span className="font-semibold text-[var(--ui-text)]">
      {accessKey || "-"}
      {hasSecret && <span className="ml-1 text-emerald-600 dark:text-emerald-300">(secret stored)</span>}
    </span>
  );
}

function StoredSecretStatus({ label, stored }: { label: string; stored: boolean }) {
  return (
    <div className="space-y-1">
      <p className="ui-caption font-semibold text-[var(--ui-text-muted)]">{label}</p>
      <div className="min-h-10 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2 ui-body text-[var(--ui-text)]">
        {stored ? "Stored — value hidden" : "Not configured"}
      </div>
    </div>
  );
}

function DetailLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="font-semibold text-slate-600 dark:text-slate-300">{label}:</span>
      {children}
    </p>
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
        replication: {
          enabled: Boolean(endpoint.features.replication?.enabled),
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
    replication: { enabled: resolveCapability(endpoint, "replication"), endpoint: "" },
    healthcheck: { enabled: true, endpoint: "", mode: "http" },
  };
  return applyFeatureConstraints(fallback, provider);
}

export default function StorageEndpointsPage() {
  const navigate = useNavigate();
  const { endpointId: endpointIdParam } = useParams();
  const { generalSettings } = useGeneralSettings();
  const currentUser = useMemo(() => readStoredUser(), []);
  const canEditEndpoints = isSuperAdminRole(currentUser?.role);
  const [endpoints, setEndpoints] = useState<StorageEndpoint[]>([]);
  const [envManaged, setEnvManaged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<EndpointEditorTab>("general");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formInitialSignature, setFormInitialSignature] = useState("");
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
    setActiveTab("general");
    setFormInitialSignature("");
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
  const editingEndpoint = useMemo(
    () => (editingId == null ? null : endpoints.find((endpoint) => endpoint.id === editingId) ?? null),
    [editingId, endpoints]
  );
  const routeEndpointId = Number(endpointIdParam ?? "");
  const hasEndpointRoute = endpointIdParam !== undefined;
  const hasValidEndpointRoute = Number.isFinite(routeEndpointId) && routeEndpointId > 0;
  const routeEndpointMissing = Boolean(
    hasEndpointRoute && !loading && (!hasValidEndpointRoute || !endpoints.some((endpoint) => endpoint.id === routeEndpointId))
  );
  const routeEndpointLoading = hasEndpointRoute && !routeEndpointMissing && !showForm;
  const configurationReadOnly = Boolean(
    editingId != null && (envManaged || editingEndpoint?.is_editable === false || !canEditEndpoints)
  );
  useEffect(() => {
    if (!showForm || !cephMode || !canEditEndpoints || configurationReadOnly) {
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
    configurationReadOnly,
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
      const awsCoordinates = awsCoordinatesForRegion(awsRegion);
      const defaultFeatures = defaultFeaturesForProvider(provider, awsRegion);
      const constrained = applyFeatureConstraints(defaultFeatures, provider);
      return {
        ...prev,
        provider,
        endpoint_url: provider === "aws" ? awsS3EndpointForRegion(awsRegion) : prev.endpoint_url,
        region: provider === "aws" ? awsRegion : prev.region,
        latitude: provider === "aws" ? (awsCoordinates?.latitude ?? "") : prev.latitude,
        longitude: provider === "aws" ? (awsCoordinates?.longitude ?? "") : prev.longitude,
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
      const nextCoordinates = awsCoordinatesForRegion(region);
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
        latitude: nextCoordinates?.latitude ?? "",
        longitude: nextCoordinates?.longitude ?? "",
        features: nextFeatures,
      };
    });
  };

  const startCreate = () => {
    if (envManaged || !canEditEndpoints) return;
    const nextForm = createEmptyForm();
    setForm(nextForm);
    setActiveTab("general");
    setFormInitialSignature(stableSignature({ form: { ...nextForm, tags: normalizeUiTags(nextForm.tags) } }));
    setShowOpsHelp(false);
    setFormError(null);
    setFeatureDetectBusy(false);
    setFeatureDetectError(null);
    setFeatureDetectWarnings([]);
    setEditingId(null);
    setShowForm(true);
  };

  const openEndpointPage = useCallback((endpoint: StorageEndpoint) => {
    const nextForm = createFormFromEndpoint(endpoint);
    setEditingId(endpoint.id);
    setActiveTab("general");
    setForm(nextForm);
    setFormInitialSignature(stableSignature({ form: { ...nextForm, tags: normalizeUiTags(nextForm.tags) } }));
    setFormError(null);
    setShowForm(true);
  }, []);

  const startEdit = (endpoint: StorageEndpoint) => {
    openEndpointPage(endpoint);
    navigate(`/admin/storage-endpoints/${endpoint.id}`);
  };

  useEffect(() => {
    if (!hasEndpointRoute || loading || !hasValidEndpointRoute) return;
    if (editingId === routeEndpointId && showForm) return;
    const endpoint = endpoints.find((candidate) => candidate.id === routeEndpointId);
    if (endpoint) {
      openEndpointPage(endpoint);
    }
  }, [
    editingId,
    endpoints,
    hasEndpointRoute,
    hasValidEndpointRoute,
    loading,
    openEndpointPage,
    routeEndpointId,
    showForm,
  ]);

  const onCloseForm = () => {
    setShowForm(false);
    resetForm();
    if (hasEndpointRoute) {
      navigate("/admin/storage-endpoints");
    }
  };
  const formCurrentSignature = useMemo(
    () => stableSignature({ form: { ...form, tags: normalizeUiTags(form.tags) } }),
    [form]
  );
  const hasFormChanges = Boolean(formInitialSignature) && formCurrentSignature !== formInitialSignature;
  const formCloseGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: hasFormChanges,
    disabled: saving,
    onClose: onCloseForm,
  });

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
    let latitude: number | null;
    let longitude: number | null;
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
      setFormError("Endpoint name is required.");
      return null;
    }
    if (!trimmedEndpoint) {
      setFormError("Endpoint URL is required.");
      return null;
    }
    try {
      latitude = parseCoordinateInput(form.latitude, "Latitude", -90, 90);
      longitude = parseCoordinateInput(form.longitude, "Longitude", -180, 180);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invalid coordinates.");
      return null;
    }

    const payload: StorageEndpointPayload = {
      name: trimmedName,
      endpoint_url: trimmedEndpoint,
      region: trimmedRegion || null,
      force_path_style: Boolean(form.force_path_style),
      verify_tls: Boolean(form.verify_tls),
      latitude,
      longitude,
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
        if (!configurationReadOnly) {
          const payload = buildPayload();
          if (!payload) {
            setSaving(false);
            return;
          }
          await updateStorageEndpoint(editingId, payload);
        }
        await updateStorageEndpointTags(editingId, { tags: normalizedTags });
        setActionMessage(configurationReadOnly ? "Endpoint tags updated." : "Endpoint updated.");
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
      if (hasEndpointRoute) {
        navigate("/admin/storage-endpoints");
      }
    } catch (err) {
      setFormError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const renderEndpointIdentity = (endpoint: StorageEndpoint) => {
    const tagItems = buildUiTagItems(endpoint.tags);
    const features = resolveFeatureState(endpoint, endpoint.provider);
    const adminEndpointOverride = features.admin.endpoint.trim();
    const stsEndpointOverride = features.sts.endpoint.trim();
    const iamEndpointOverride = features.iam.endpoint.trim();
    const showAdminEndpoint =
      features.admin.enabled &&
      Boolean(adminEndpointOverride) &&
      adminEndpointOverride !== endpoint.endpoint_url;
    const showStsEndpoint =
      features.sts.enabled &&
      Boolean(stsEndpointOverride) &&
      stsEndpointOverride !== endpoint.endpoint_url;
    const showIamEndpoint =
      features.iam.enabled &&
      Boolean(iamEndpointOverride) &&
      iamEndpointOverride !== endpoint.endpoint_url;

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ui-body font-semibold text-primary hover:underline dark:text-primary-300"
            onClick={() => startEdit(endpoint)}
            aria-label={`Open endpoint ${endpoint.name}`}
          >
            {endpoint.name}
          </button>
          {endpoint.is_default && <StatusBadge label="Default" />}
          {envManaged && <LockBadge label="Env managed" />}
          {!envManaged && !endpoint.is_editable && <LockBadge label="Protected" />}
        </div>
        <code className={cx(endpointInlineCodeClass, "block max-w-[340px] truncate")} title={endpoint.endpoint_url}>
          {endpoint.endpoint_url}
        </code>
        {showAdminEndpoint && (
          <DetailLine label="Admin endpoint">
            <code className={cx(endpointInlineCodeClass, "max-w-[260px] truncate")} title={adminEndpointOverride}>
              {adminEndpointOverride}
            </code>
          </DetailLine>
        )}
        {showStsEndpoint && (
          <DetailLine label="STS endpoint">
            <code className={cx(endpointInlineCodeClass, "max-w-[260px] truncate")} title={stsEndpointOverride}>
              {stsEndpointOverride}
            </code>
          </DetailLine>
        )}
        {showIamEndpoint && (
          <DetailLine label="IAM endpoint">
            <code className={cx(endpointInlineCodeClass, "max-w-[260px] truncate")} title={iamEndpointOverride}>
              {iamEndpointOverride}
            </code>
          </DetailLine>
        )}
        <UiTagBadgeList
          items={tagItems}
          variant="listing-compact"
          layout="inline-compact"
          maxVisible={5}
          emptyLabel="No tags"
        />
      </div>
    );
  };

  const renderEndpointProvider = (endpoint: StorageEndpoint) => (
    <div className="space-y-2">
      <ProviderBadge provider={endpoint.provider} />
      <DetailLine label="Region">
        <span className="font-semibold text-[var(--ui-text)]">{endpoint.region || "Default"}</span>
      </DetailLine>
    </div>
  );

  const renderEndpointConnectivity = (endpoint: StorageEndpoint) => {
    const features = resolveFeatureState(endpoint, endpoint.provider);
    const verifyTls = endpoint.verify_tls !== false;
    const forcePathStyle = Boolean(endpoint.force_path_style);
    const healthcheckMode = features.healthcheck.mode === "s3" ? "s3" : "http";
    const healthcheckUrl = features.healthcheck.endpoint.trim();
    const hasCoordinates = endpoint.latitude != null && endpoint.longitude != null;

    return (
      <div className="space-y-1.5">
        <DetailLine label="TLS">
          <span className={`font-semibold ${verifyTls ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
            {verifyTls ? "Enabled" : "Disabled (insecure)"}
          </span>
        </DetailLine>
        <DetailLine label="Path style">
          <span className="font-semibold text-[var(--ui-text)]">{forcePathStyle ? "Forced" : "Virtual-host style"}</span>
        </DetailLine>
        <DetailLine label="GPS">
          <span className="font-semibold text-[var(--ui-text)]">
            {hasCoordinates ? `${endpoint.latitude}, ${endpoint.longitude}` : "Not set"}
          </span>
        </DetailLine>
        <DetailLine label="Healthcheck">
          <code className={endpointInlineCodeClass}>{healthcheckMode.toUpperCase()}</code>
          {healthcheckUrl && (
            <code className={cx(endpointInlineCodeClass, "max-w-[180px] truncate")} title={healthcheckUrl}>
              {healthcheckUrl}
            </code>
          )}
        </DetailLine>
      </div>
    );
  };

  const renderEndpointFeatures = (endpoint: StorageEndpoint) => {
    const features = resolveFeatureState(endpoint, endpoint.provider);

    return (
      <div className="flex flex-wrap gap-1.5">
        {ENDPOINT_LIST_FEATURES.map((feature) => (
          <FeatureBadge
            key={feature.key}
            label={feature.label}
            enabled={features[feature.key].enabled}
          />
        ))}
      </div>
    );
  };

  const renderEndpointCredentials = (endpoint: StorageEndpoint) => (
    <div className="space-y-1.5">
      <DetailLine label="Admin key">
        {endpoint.provider === "ceph" ? (
          <CredentialSummary accessKey={endpoint.admin_access_key} hasSecret={endpoint.has_admin_secret} emptyLabel="Not configured" />
        ) : (
          <span className="font-semibold text-slate-500 dark:text-slate-400">Not required</span>
        )}
      </DetailLine>
      <DetailLine label="Supervision">
        <CredentialSummary accessKey={endpoint.supervision_access_key} hasSecret={endpoint.has_supervision_secret} />
      </DetailLine>
      {endpoint.provider === "ceph" && cephAdminConfigEnabled && (
        <DetailLine label="Ceph Admin">
          <CredentialSummary accessKey={endpoint.ceph_admin_access_key} hasSecret={endpoint.has_ceph_admin_secret} />
        </DetailLine>
      )}
    </div>
  );

  const renderEndpointActions = (endpoint: StorageEndpoint) => {
    const settingDefault = defaultBusyId === endpoint.id;
    const readOnly = envManaged || !endpoint.is_editable || !canEditEndpoints;

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!endpoint.is_default && (
          <button
            className={tableActionButtonClasses}
            onClick={() => handleSetDefault(endpoint)}
            type="button"
            disabled={Boolean(defaultBusyId) || envManaged || !canEditEndpoints}
          >
            {settingDefault ? "Setting..." : "Set as default"}
          </button>
        )}
        <button
          className={tableActionButtonClasses}
          onClick={() => startEdit(endpoint)}
          type="button"
        >
          {readOnly ? "View" : "Edit"}
        </button>
        {!readOnly ? (
          <>
            <button
              className={tableDeleteActionClasses}
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
          <span className="ui-caption font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {canEditEndpoints ? "Config read-only" : "Read-only"}
          </span>
        )}
      </div>
    );
  };

  const endpointTableStatus = resolveListTableStatus({
    loading,
    error: null,
    rowCount: endpoints.length,
  });
  const endpointTableColumns: Array<DataTableColumn<StorageEndpoint>> = [
    {
      id: "endpoint",
      label: "Endpoint",
      primary: true,
      cellClassName: "min-w-[300px] max-w-[380px] align-top",
      render: renderEndpointIdentity,
    },
    {
      id: "provider",
      label: "Provider",
      cellClassName: "min-w-[150px] align-top",
      render: renderEndpointProvider,
    },
    {
      id: "connectivity",
      label: "Connectivity",
      cellClassName: "min-w-[260px] align-top",
      render: renderEndpointConnectivity,
    },
    {
      id: "features",
      label: "Features",
      cellClassName: "min-w-[360px] align-top",
      render: renderEndpointFeatures,
    },
    {
      id: "credentials",
      label: "Credentials",
      cellClassName: "min-w-[260px] align-top",
      render: renderEndpointCredentials,
    },
    {
      id: "actions",
      label: "Actions",
      align: "right",
      mobileRole: "actions",
      cellClassName: "min-w-[220px] align-top",
      render: renderEndpointActions,
    },
  ];

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
  const editorTabs = [
    { id: "general", label: "Connection" },
    { id: "credentials", label: "Credentials" },
    { id: "capabilities", label: "Capabilities & health" },
  ];
  const signedProbeBlockedReason = !cephMode
    ? "S3 signed probe is available only for Ceph endpoints."
    : !hasSupervisionCredentialsForSignedProbe
    ? "S3 signed probe requires Supervision credentials (access key + secret key)."
    : null;
  const editorEndpointName = form.name.trim() || editingEndpoint?.name || "Endpoint";
  const editorTitle = editingId
    ? `${configurationReadOnly ? "Storage endpoint" : "Edit storage endpoint"} · ${editorEndpointName}`
    : "New storage endpoint";
  const providerOptionClass = cx(
    "flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 shadow-sm transition dark:border-slate-700 dark:text-slate-100",
    configurationReadOnly
      ? "cursor-not-allowed opacity-70"
      : "cursor-pointer hover:border-primary hover:text-primary dark:hover:border-primary-400 dark:hover:text-primary-100"
  );

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
      {routeEndpointLoading ? (
        <WorkflowPage
          title="Loading storage endpoint"
          description="Retrieving endpoint configuration and access mode."
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: "Loading" })}
          width="narrow"
        >
          <PageBanner tone="info">Loading endpoint configuration...</PageBanner>
        </WorkflowPage>
      ) : routeEndpointMissing ? (
        <WorkflowPage
          title="Storage endpoint not found"
          description="The requested endpoint does not exist or is no longer available."
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", { label: "Not found" })}
          backLabel="Back to endpoints"
          onBack={() => navigate("/admin/storage-endpoints")}
          width="narrow"
        >
          <PageBanner tone="warning">Select an endpoint from the current storage endpoint list.</PageBanner>
        </WorkflowPage>
      ) : !showForm ? (
        <>
      <PageHeader
        title="S3 Endpoints"
        description="Manage the S3/Ceph endpoints used by the console."
        breadcrumbs={adminPageBreadcrumbs("storage-endpoints")}
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
      <ListPageSection
          title="S3 Endpoints"
          description="Configured S3/Ceph endpoints and operational capabilities."
          countLabel={`${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`}
      >
        <DataTableShell
          columns={endpointTableColumns}
          rows={loading ? [] : endpoints}
          rowKey={(endpoint) => endpoint.id}
          status={endpointTableStatus}
          loadingMessage="Loading endpoints..."
          errorMessage="Unable to load endpoints."
          emptyMessage="No endpoints configured yet."
          primaryColumnId="endpoint"
          responsiveCards
          tableClassName="compact-table"
          containerClassName="rounded-t-none border-x-0 border-b-0"
        />
      </ListPageSection>
        </>
      ) : null}

      {showForm && (
        <WorkflowPage
          title={editorTitle}
          description="Manage connection settings, operational credentials, capabilities, and health checks for this endpoint."
          breadcrumbs={adminPageBreadcrumbs("storage-endpoints", {
            label: editingId ? editingEndpoint?.name ?? "Endpoint" : "Create",
          })}
          backLabel="Back to endpoints"
          onBack={formCloseGuard.requestClose}
          contentVariant="plain"
          width="wide"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && <PageBanner tone="error">{formError}</PageBanner>}
            {configurationReadOnly && (
              <PageBanner tone="info">
                Endpoint configuration is read-only. {canEditEndpoints
                  ? "You can still update the tags associated with this endpoint."
                  : "All settings and tags are available for consultation only."}
              </PageBanner>
            )}
            {endpointTagCatalogError && <PageBanner tone="warning">{endpointTagCatalogError}</PageBanner>}
            <PageTabs
              tabs={editorTabs}
              activeTab={activeTab}
              onChange={(tab) => setActiveTab(tab as EndpointEditorTab)}
              variant="line"
              ariaLabel="Endpoint configuration sections"
              idPrefix="endpoint-editor"
            />

            {activeTab === "general" && (
              <div
                id="endpoint-editor-panel-general"
                role="tabpanel"
                aria-labelledby="endpoint-editor-tab-general"
              >
                <WorkflowSection
                  title="Identity and connection"
                  description="Name the backend, identify its provider and define how S3 Manager reaches it."
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <UiInput
                      label="Endpoint name"
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      className={endpointReadOnlyInputClass}
                      readOnly={configurationReadOnly}
                      required
                    />

                    <div>
                      <p className="mb-1 ui-caption font-semibold text-[var(--ui-text-muted)]">Endpoint tags</p>
                      {canEditEndpoints ? (
                        <UiTagEditor
                          label="Endpoint tags"
                          tags={form.tags}
                          catalog={endpointTagCatalog}
                          onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
                          placeholder="Add a tag for this endpoint"
                          hint={endpointTagCatalogLoading ? "Loading existing endpoint tags..." : undefined}
                          hideLabel
                          compact
                        />
                      ) : (
                        <div className="min-h-10 rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] px-3 py-2">
                          <UiTagBadgeList items={buildUiTagItems(form.tags)} emptyLabel="No tags" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
            <div className="space-y-2">
              <span className="ui-body font-semibold text-slate-700 dark:text-slate-100">Provider</span>
              <div className="flex gap-3">
                <label className={providerOptionClass}>
                  <input
                    type="radio"
                    name="provider"
                    value="ceph"
                    checked={form.provider === "ceph"}
                    onChange={() => handleProviderChange("ceph")}
                    disabled={configurationReadOnly}
                  />
                  <span>Ceph</span>
                </label>
                <label className={providerOptionClass}>
                  <input
                    type="radio"
                    name="provider"
                    value="aws"
                    checked={form.provider === "aws"}
                    onChange={() => handleProviderChange("aws")}
                    disabled={configurationReadOnly}
                  />
                  <span>AWS</span>
                </label>
                <label className={providerOptionClass}>
                  <input
                    type="radio"
                    name="provider"
                    value="other"
                    checked={form.provider === "other"}
                    onChange={() => handleProviderChange("other")}
                    disabled={configurationReadOnly}
                  />
                  <span>Other</span>
                </label>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <UiInput
                label="S3 endpoint URL"
                value={awsMode ? computedAwsS3Endpoint : form.endpoint_url}
                onChange={(e) => {
                  if (!awsMode) {
                    setForm((prev) => ({ ...prev, endpoint_url: e.target.value }));
                  }
                }}
                className={endpointReadOnlyInputClass}
                placeholder={awsMode ? computedAwsS3Endpoint : "https://s3.example.com"}
                readOnly={configurationReadOnly || awsMode}
                required
              />
              <UiInput
                label="Region (optional)"
                value={form.region}
                onChange={(e) => handleRegionChange(e.target.value)}
                className={endpointReadOnlyInputClass}
                readOnly={configurationReadOnly}
                placeholder="us-east-1"
              />
              <UiInput
                label="Latitude (optional)"
                type="number"
                value={form.latitude}
                onChange={(e) => setForm((prev) => ({ ...prev, latitude: e.target.value }))}
                className={endpointReadOnlyInputClass}
                readOnly={configurationReadOnly}
                placeholder="48.8566"
                min="-90"
                max="90"
                step="any"
              />
              <UiInput
                label="Longitude (optional)"
                type="number"
                value={form.longitude}
                onChange={(e) => setForm((prev) => ({ ...prev, longitude: e.target.value }))}
                className={endpointReadOnlyInputClass}
                readOnly={configurationReadOnly}
                placeholder="2.3522"
                min="-180"
                max="180"
                step="any"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
              <label className="flex items-center justify-between gap-4 ui-body font-semibold text-slate-700 dark:text-slate-100">
                Force path style
                <input
                  type="checkbox"
                  checked={form.force_path_style}
                  onChange={(e) => setForm((prev) => ({ ...prev, force_path_style: e.target.checked }))}
                  className={endpointToggleCheckboxClass}
                  disabled={configurationReadOnly}
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
                  className={endpointToggleCheckboxClass}
                  disabled={configurationReadOnly}
                />
              </label>
              {!form.verify_tls && (
                <p className="mt-2 ui-caption text-amber-700 dark:text-amber-300">
                  TLS certificate validation is disabled for this endpoint. Use only in trusted environments.
                </p>
              )}
            </div>

                  </div>
                </WorkflowSection>
              </div>
            )}

            {activeTab === "credentials" && (
              <div
                id="endpoint-editor-panel-credentials"
                role="tabpanel"
                aria-labelledby="endpoint-editor-tab-credentials"
              >
                <WorkflowSection
                  title="Operational credentials"
                  description="Keep administrative, monitoring and cluster-wide identities isolated by purpose."
                >
                  <div className="space-y-4">
            {cephMode ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ui-body text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Management</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                      <p>Administration (Admin Ops)</p>
                      <div className="grid gap-3">
                        <UiInput
                          label="Admin access key"
                          value={form.admin_access_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, admin_access_key: e.target.value }))}
                          className={endpointReadOnlyInputClass}
                          readOnly={configurationReadOnly}
                          placeholder="Access key admin"
                          required={form.features.admin.enabled}
                        />
                        {configurationReadOnly ? (
                          <StoredSecretStatus label="Admin secret key" stored={form.has_admin_secret} />
                        ) : (
                          <UiInput
                            label="Admin secret key"
                            type="password"
                            value={form.admin_secret_key}
                            onChange={(e) => setForm((prev) => ({ ...prev, admin_secret_key: e.target.value }))}
                            placeholder={editingId ? "Secret key admin (leave blank to keep)" : "Secret key admin"}
                            required={!editingId && form.features.admin.enabled}
                          />
                        )}
                      </div>
                      {!configurationReadOnly && <p className="ui-caption font-normal text-slate-500 dark:text-slate-400">
                        {editingId ? "Leave the secret key empty to keep the current one." : "Required when admin is enabled."}
                      </p>}
                    </div>
                    <div className="space-y-1 ui-body font-semibold text-slate-700 dark:text-slate-100">
                      <p>Monitoring (Supervision Ops)</p>
                      <div className="grid gap-3">
                        <UiInput
                          label="Supervision access key"
                          value={form.supervision_access_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, supervision_access_key: e.target.value }))}
                          className={endpointReadOnlyInputClass}
                          readOnly={configurationReadOnly}
                          placeholder="Access key supervision"
                          required={form.features.usage.enabled || form.features.metrics.enabled}
                        />
                        {configurationReadOnly ? (
                          <StoredSecretStatus label="Supervision secret key" stored={form.has_supervision_secret} />
                        ) : (
                          <UiInput
                            label="Supervision secret key"
                            type="password"
                            value={form.supervision_secret_key}
                            onChange={(e) => setForm((prev) => ({ ...prev, supervision_secret_key: e.target.value }))}
                            placeholder="Secret key supervision"
                            required={!editingId && (form.features.usage.enabled || form.features.metrics.enabled)}
                          />
                        )}
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
                    <UiButton
                      size="xs"
                      variant="secondary"
                      onClick={() => setShowOpsHelp((prev) => !prev)}
                      aria-expanded={showOpsHelp}
                    >
                      {showOpsHelp ? "Hide" : "Show"}
                    </UiButton>
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
                      <UiInput
                        label="Ceph Admin access key"
                        value={form.ceph_admin_access_key}
                        onChange={(e) => setForm((prev) => ({ ...prev, ceph_admin_access_key: e.target.value }))}
                        className={endpointReadOnlyInputClass}
                        readOnly={configurationReadOnly}
                        placeholder="Ceph Admin access key"
                      />
                      {configurationReadOnly ? (
                        <StoredSecretStatus
                          label="Ceph Admin secret key"
                          stored={Boolean(editingEndpoint?.has_ceph_admin_secret)}
                        />
                      ) : (
                        <UiInput
                          label="Ceph Admin secret key"
                          type="password"
                          value={form.ceph_admin_secret_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, ceph_admin_secret_key: e.target.value }))}
                          placeholder={editingId ? "Ceph Admin secret key (leave blank to keep)" : "Ceph Admin secret key"}
                        />
                      )}
                    </div>
                    {!configurationReadOnly && <p className="mt-2">
                      {editingId
                        ? "Leave the secret key empty to keep the current one."
                        : "Recommended: keep this account dedicated to ceph-admin only."}
                    </p>}
                    <p className="mt-3 font-semibold text-amber-900 dark:text-amber-100">Ceph (radosgw-admin) example</p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
                      {CEPH_ADMIN_COMMAND}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <PageBanner tone="info">
                {form.provider === "aws"
                  ? "AWS endpoints use the active execution identity and do not require dedicated management credentials here."
                  : "This provider does not use dedicated operational credentials in S3 Manager."}
              </PageBanner>
            )}
                  </div>
                </WorkflowSection>
              </div>
            )}

            {activeTab === "capabilities" && (
              <div
                id="endpoint-editor-panel-capabilities"
                role="tabpanel"
                aria-labelledby="endpoint-editor-tab-capabilities"
              >
                <WorkflowSection
                  title="Capabilities and health"
                  description="Review detected Ceph services, S3 capabilities and the probe used to monitor this endpoint."
                >
                  <div className="space-y-4">
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
                          className={endpointToggleCardDisabledClass}
                        >
                          Admin enabled
                          <input
                            type="checkbox"
                            checked={form.features.admin.enabled}
                            readOnly
                            className={endpointToggleCheckboxClass}
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className={endpointToggleCardDisabledClass}
                        >
                          Accounts enabled
                          <input
                            type="checkbox"
                            checked={form.features.account.enabled}
                            readOnly
                            className={endpointToggleCheckboxClass}
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className={endpointToggleCardDisabledClass}
                        >
                          Usage Log enabled
                          <input
                            type="checkbox"
                            checked={form.features.usage.enabled}
                            readOnly
                            className={endpointToggleCheckboxClass}
                            disabled
                          />
                        </label>
                        <label
                          title="This option is automatically detected from credentials and cannot be manually changed."
                          className={endpointToggleCardDisabledClass}
                        >
                          Metrics enabled
                          <input
                            type="checkbox"
                            checked={form.features.metrics.enabled}
                            readOnly
                            className={endpointToggleCheckboxClass}
                            disabled
                          />
                        </label>
                        <label className={endpointToggleCardClass}>
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
                            className={endpointToggleCheckboxClass}
                            disabled={configurationReadOnly || !cephMode}
                          />
                        </label>
                        <label className={endpointToggleCardClass}>
                          Bucket replication enabled
                          <input
                            type="checkbox"
                            checked={form.features.replication.enabled}
                            onChange={(e) =>
                              updateFeatures((current) => ({
                                ...current,
                                replication: { ...current.replication, enabled: e.target.checked },
                              }))
                            }
                            className={endpointToggleCheckboxClass}
                            disabled={configurationReadOnly || !cephMode}
                          />
                        </label>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <UiInput
                          label="Ceph admin endpoint override (optional)"
                          value={form.features.admin.endpoint}
                          onChange={(e) =>
                            updateFeatures((current) => ({
                              ...current,
                              admin: { ...current.admin, endpoint: e.target.value },
                            }))
                          }
                          className={endpointReadOnlyInputClass}
                          readOnly={configurationReadOnly}
                          placeholder="http://rgw-admin.local"
                        />
                      </div>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Admin, account API, usage log, and metrics are auto-detected from credentials. Usage log/metrics require supervision credentials.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">S3</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className={endpointToggleCardClass}>
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
                          className={endpointToggleCheckboxClass}
                          disabled={configurationReadOnly}
                        />
                      </label>
                      <label className={endpointToggleCardClass}>
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
                          className={endpointToggleCheckboxClass}
                          disabled={configurationReadOnly}
                        />
                      </label>
                      <label className={endpointToggleCardClass}>
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
                          className={endpointToggleCheckboxClass}
                          disabled={configurationReadOnly}
                        />
                      </label>
                      <label className={endpointToggleCardClass}>
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
                          className={endpointToggleCheckboxClass}
                          disabled={configurationReadOnly}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <UiInput
                    label={awsMode ? "STS endpoint" : "STS endpoint override (optional)"}
                    value={awsMode ? computedAwsStsEndpoint : form.features.sts.endpoint}
                    onChange={(e) => {
                      if (!awsMode) {
                        updateFeatures((current) => ({
                          ...current,
                          sts: { ...current.sts, endpoint: e.target.value },
                        }));
                      }
                    }}
                    className={endpointReadOnlyInputClass}
                    placeholder={awsMode ? computedAwsStsEndpoint : "https://sts.example.com"}
                    disabled={!form.features.sts.enabled}
                    readOnly={configurationReadOnly || awsMode}
                    title={!form.features.sts.enabled ? "Enable STS first to define a dedicated STS endpoint." : undefined}
                  />
                  <UiInput
                    label={awsMode ? "IAM endpoint" : "IAM endpoint override (optional)"}
                    value={awsMode ? computedAwsIamEndpoint : form.features.iam.endpoint}
                    onChange={(e) => {
                      if (!awsMode) {
                        updateFeatures((current) => ({
                          ...current,
                          iam: { ...current.iam, endpoint: e.target.value },
                        }));
                      }
                    }}
                    className={endpointReadOnlyInputClass}
                    placeholder={awsMode ? computedAwsIamEndpoint : "https://iam.example.com"}
                    disabled={!form.features.iam.enabled}
                    readOnly={configurationReadOnly || awsMode}
                    title={!form.features.iam.enabled ? "Enable IAM first to define a dedicated IAM endpoint." : undefined}
                  />
                  <UiSelect
                    label="Healthcheck mode"
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
                    disabled={configurationReadOnly || !cephMode}
                    title={!cephMode ? "Healthcheck signed mode is available only for Ceph endpoints." : signedProbeBlockedReason ?? undefined}
                  >
                    <option value="http">HTTP probe</option>
                    <option value="s3" disabled={Boolean(signedProbeBlockedReason)} title={signedProbeBlockedReason ?? undefined}>
                      S3 signed probe{signedProbeBlockedReason ? " (requires supervision credentials)" : ""}
                    </option>
                  </UiSelect>
                  <UiInput
                    label="Healthcheck URL override (optional)"
                    fieldClassName="sm:col-span-2"
                    value={form.features.healthcheck.endpoint}
                    onChange={(e) =>
                      updateFeatures((current) => ({
                        ...current,
                        healthcheck: { ...current.healthcheck, endpoint: e.target.value },
                      }))
                    }
                    className={endpointReadOnlyInputClass}
                    readOnly={configurationReadOnly}
                    placeholder="https://rgw.example.com/healthz"
                    hint="Empty value uses the endpoint URL. S3 mode signs a lightweight request with endpoint credentials."
                  />
                </div>
              </div>

            </div>
                  </div>
                </WorkflowSection>
              </div>
            )}

            {(!configurationReadOnly || canEditEndpoints) && (
              <WorkflowActions className="sticky bottom-0 z-10 bg-[var(--ui-surface)] py-3 shadow-[0_-8px_18px_-16px_rgba(15,23,42,0.45)]">
                <UiButton variant="secondary" size="sm" onClick={formCloseGuard.requestClose}>
                  {configurationReadOnly ? "Back to endpoints" : "Cancel"}
                </UiButton>
                <UiButton
                  type="submit"
                  size="sm"
                  disabled={saving || !hasFormChanges}
                  title={saving ? "Save in progress." : !hasFormChanges ? "No changes to save." : undefined}
                >
                  {saving ? "Saving..." : editingId ? (configurationReadOnly ? "Save tags" : "Update endpoint") : "Create endpoint"}
                </UiButton>
              </WorkflowActions>
            )}
            {formCloseGuard.confirmationDialog}
          </form>
        </WorkflowPage>
      )}

      {deleteTarget && (
        <Modal title="Delete endpoint" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            {deleteError && <PageBanner tone="error">{deleteError}</PageBanner>}
            <p className="ui-body text-slate-700 dark:text-slate-100">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <UiButton
                onClick={() => setDeleteTarget(null)}
                variant="secondary"
                size="sm"
              >
                Cancel
              </UiButton>
              <UiButton
                onClick={handleDelete}
                disabled={deleteBusy}
                variant="danger"
                size="sm"
              >
                {deleteBusy ? "Deleting..." : "Delete"}
              </UiButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
