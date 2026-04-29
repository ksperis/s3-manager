/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { StorageEndpoint } from "../../api/storageEndpoints";

export type S3ConnectionEndpointMode = "preset" | "custom";

export const S3_CONNECTION_PROVIDER_HINT_OPTIONS = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];

export type S3ConnectionEndpointDraft = {
  provider_hint: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
};

type S3ConnectionEndpointFieldsProps = {
  mode: S3ConnectionEndpointMode;
  onModeChange: (mode: S3ConnectionEndpointMode) => void;
  modeInputName: string;
  endpointId: string;
  onEndpointIdChange: (endpointId: string) => void;
  endpoints: StorageEndpoint[];
  loadingEndpoints: boolean;
  form: S3ConnectionEndpointDraft;
  onFormChange: <K extends keyof S3ConnectionEndpointDraft>(field: K, value: S3ConnectionEndpointDraft[K]) => void;
  errorMessage?: string | null;
};

const inputClasses =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 ui-body text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const labelClasses = "ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const checkboxLabelClasses = "flex items-center gap-2 ui-caption font-semibold text-slate-600 dark:text-slate-300";

export default function S3ConnectionEndpointFields({
  mode,
  onModeChange,
  modeInputName,
  endpointId,
  onEndpointIdChange,
  endpoints,
  loadingEndpoints,
  form,
  onFormChange,
  errorMessage,
}: S3ConnectionEndpointFieldsProps) {
  const hasConfiguredEndpoints = endpoints.length > 0;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div>
        <p className={labelClasses}>Endpoint</p>
        <p className="ui-caption text-slate-500 dark:text-slate-400">
          Choose a configured endpoint or enter a public HTTPS custom endpoint.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className={checkboxLabelClasses}>
          <input
            type="radio"
            name={modeInputName}
            checked={mode === "preset"}
            onChange={() => onModeChange("preset")}
            disabled={!hasConfiguredEndpoints}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary disabled:opacity-60"
          />
          Configured endpoint
        </label>
        <label className={checkboxLabelClasses}>
          <input
            type="radio"
            name={modeInputName}
            checked={mode === "custom"}
            onChange={() => onModeChange("custom")}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
          />
          Custom endpoint
        </label>
      </div>
      {mode === "preset" ? (
        <label className="block">
          <span className={labelClasses}>Configured endpoint</span>
          <select
            value={endpointId}
            onChange={(event) => onEndpointIdChange(event.target.value)}
            disabled={loadingEndpoints || !hasConfiguredEndpoints}
            className={inputClasses}
          >
            <option value="">
              {loadingEndpoints
                ? "Loading endpoints..."
                : hasConfiguredEndpoints
                  ? "Select endpoint"
                  : "No configured endpoint"}
            </option>
            {endpoints.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name} ({endpoint.endpoint_url})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClasses}>Provider</span>
            <select
              value={form.provider_hint}
              onChange={(event) => onFormChange("provider_hint", event.target.value)}
              className={inputClasses}
            >
              {S3_CONNECTION_PROVIDER_HINT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClasses}>Region</span>
            <input
              type="text"
              value={form.region}
              onChange={(event) => onFormChange("region", event.target.value)}
              className={inputClasses}
              placeholder="us-east-1"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClasses}>Endpoint URL</span>
            <input
              type="url"
              value={form.endpoint_url}
              onChange={(event) => onFormChange("endpoint_url", event.target.value)}
              className={inputClasses}
              placeholder="https://s3.example.com"
            />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <label className={checkboxLabelClasses}>
              <input
                type="checkbox"
                checked={form.force_path_style}
                onChange={(event) => onFormChange("force_path_style", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              Force path style
            </label>
            <label className={checkboxLabelClasses}>
              <input
                type="checkbox"
                checked={form.verify_tls}
                onChange={(event) => onFormChange("verify_tls", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              Verify TLS
            </label>
          </div>
        </div>
      )}
      {errorMessage && <p className="ui-caption text-amber-700 dark:text-amber-300">{errorMessage}</p>}
    </div>
  );
}
