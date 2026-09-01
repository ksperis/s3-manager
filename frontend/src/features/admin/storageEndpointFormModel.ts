/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  StorageEndpoint,
  StorageProvider,
} from "../../api/storageEndpoints";
import { normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";

export type FeatureKey =
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

type HealthcheckMode = "http" | "s3";

type FeatureState = {
  enabled: boolean;
  endpoint: string;
  mode?: HealthcheckMode;
};

export type FeaturesState = Record<FeatureKey, FeatureState>;

export type FormState = {
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

export const AWS_DEFAULT_REGION = "us-east-1";

const AWS_IAM_ENDPOINT = "https://iam.amazonaws.com";
const AWS_GOV_IAM_ENDPOINT = "https://iam.us-gov.amazonaws.com";
const AWS_CN_IAM_ENDPOINT = "https://iam.cn-north-1.amazonaws.com.cn";
const AWS_REGION_COORDINATES: Record<
  string,
  { latitude: string; longitude: string }
> = {
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

export function normalizeAwsRegion(region?: string | null): string {
  const normalized = (region ?? "").trim().toLowerCase();
  return normalized || AWS_DEFAULT_REGION;
}

function awsDnsSuffixForRegion(region?: string | null): string {
  return normalizeAwsRegion(region).startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
}

export function awsS3EndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  return `https://s3.${normalized}.${awsDnsSuffixForRegion(normalized)}`;
}

export function awsStsEndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  return `https://sts.${normalized}.${awsDnsSuffixForRegion(normalized)}`;
}

export function awsIamEndpointForRegion(region?: string | null): string {
  const normalized = normalizeAwsRegion(region);
  if (normalized.startsWith("cn-")) return AWS_CN_IAM_ENDPOINT;
  if (normalized.startsWith("us-gov-")) return AWS_GOV_IAM_ENDPOINT;
  return AWS_IAM_ENDPOINT;
}

export function awsCoordinatesForRegion(
  region?: string | null,
): { latitude: string; longitude: string } | null {
  return AWS_REGION_COORDINATES[normalizeAwsRegion(region)] ?? null;
}

function formatCoordinateInput(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function parseCoordinateInput(
  value: string,
  label: string,
  min: number,
  max: number,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

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

export function defaultFeaturesForProvider(
  provider: StorageProvider,
  region = AWS_DEFAULT_REGION,
): FeaturesState {
  const base = createEmptyFeatures();
  if (provider === "ceph") {
    return {
      ...base,
      iam: { ...base.iam, enabled: true },
    };
  }
  if (provider === "aws") {
    return {
      ...base,
      sts: {
        ...base.sts,
        enabled: true,
        endpoint: awsStsEndpointForRegion(region),
      },
      static_website: { ...base.static_website, enabled: true },
      iam: {
        ...base.iam,
        enabled: true,
        endpoint: awsIamEndpointForRegion(region),
      },
      sse: { ...base.sse, enabled: true },
    };
  }
  return {
    ...base,
    iam: { ...base.iam, enabled: true },
  };
}

export function applyFeatureConstraints(
  features: FeaturesState,
  provider: StorageProvider,
): FeaturesState {
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
    healthcheck: {
      ...features.healthcheck,
      mode: features.healthcheck.mode === "s3" ? "s3" : "http",
    },
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

export function buildFeaturesYaml(features: FeaturesState): string {
  const lines: string[] = ["features:"];
  FEATURE_KEYS.forEach((key) => {
    const entry = features[key];
    lines.push(`  ${key}:`);
    lines.push(`    enabled: ${entry.enabled ? "true" : "false"}`);
    if (
      (key === "admin" || key === "sts" || key === "iam") &&
      entry.enabled &&
      entry.endpoint.trim()
    ) {
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

export function createEmptyForm(): FormState {
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

export const EMPTY_STORAGE_ENDPOINT_FORM: FormState = createEmptyForm();

export function resolveFeatureState(
  endpoint: StorageEndpoint,
  provider: StorageProvider,
): FeaturesState {
  return applyFeatureConstraints(
    {
      admin: {
        enabled: endpoint.features.admin.enabled,
        endpoint: endpoint.features.admin.endpoint ?? "",
      },
      account: { enabled: endpoint.features.account.enabled, endpoint: "" },
      sts: {
        enabled: endpoint.features.sts.enabled,
        endpoint: endpoint.features.sts.endpoint ?? "",
      },
      usage: { enabled: endpoint.features.usage.enabled, endpoint: "" },
      metrics: { enabled: endpoint.features.metrics.enabled, endpoint: "" },
      static_website: {
        enabled: endpoint.features.static_website.enabled,
        endpoint: "",
      },
      iam: {
        enabled: endpoint.features.iam.enabled,
        endpoint: endpoint.features.iam.endpoint ?? "",
      },
      sns: { enabled: endpoint.features.sns.enabled, endpoint: "" },
      sse: { enabled: endpoint.features.sse.enabled, endpoint: "" },
      replication: {
        enabled: endpoint.features.replication.enabled,
        endpoint: "",
      },
      healthcheck: {
        enabled: endpoint.features.healthcheck.enabled,
        endpoint: endpoint.features.healthcheck.url ?? "",
        mode: endpoint.features.healthcheck.mode,
      },
    },
    provider,
  );
}

export function createFormFromEndpoint(endpoint: StorageEndpoint): FormState {
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
