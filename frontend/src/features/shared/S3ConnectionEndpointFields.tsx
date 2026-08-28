/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { StorageEndpoint } from "../../api/storageEndpoints";
import UiCheckboxField from "../../components/ui/UiCheckboxField";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiCheckboxClass,
  uiLabelClass,
  uiMutedTextClass,
  uiPanelMutedClass,
} from "../../components/ui/styles";
import type { S3ConnectionEndpointMode } from "./s3ConnectionFormModel";

const S3_CONNECTION_PROVIDER_HINT_OPTIONS = [
  { value: "", label: "(auto)" },
  { value: "aws", label: "AWS" },
  { value: "ceph", label: "Ceph RGW" },
  { value: "scality", label: "Scality" },
  { value: "minio", label: "MinIO" },
  { value: "other", label: "Other" },
];

type S3ConnectionEndpointDraft = {
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
  endpoints: Array<Pick<StorageEndpoint, "id" | "name" | "endpoint_url" | "is_default">>;
  loadingEndpoints: boolean;
  form: S3ConnectionEndpointDraft;
  onFormChange: <K extends keyof S3ConnectionEndpointDraft>(field: K, value: S3ConnectionEndpointDraft[K]) => void;
  errorMessage?: string | null;
};

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
    <div className={cx("space-y-3 px-3 py-3", uiPanelMutedClass)}>
      <div>
        <p className={uiLabelClass}>Endpoint</p>
        <p className={cx("ui-caption", uiMutedTextClass)}>
          Choose a configured endpoint or enter a public HTTPS custom endpoint.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className={cx("flex items-center gap-2 ui-caption font-semibold", uiMutedTextClass)}>
          <input
            type="radio"
            name={modeInputName}
            checked={mode === "preset"}
            onChange={() => onModeChange("preset")}
            disabled={!hasConfiguredEndpoints}
            className={cx(uiCheckboxClass, "rounded-full disabled:opacity-60")}
          />
          Configured endpoint
        </label>
        <label className={cx("flex items-center gap-2 ui-caption font-semibold", uiMutedTextClass)}>
          <input
            type="radio"
            name={modeInputName}
            checked={mode === "custom"}
            onChange={() => onModeChange("custom")}
            className={cx(uiCheckboxClass, "rounded-full")}
          />
          Custom endpoint
        </label>
      </div>
      {mode === "preset" ? (
        <UiSelect
          label="Configured endpoint"
          value={endpointId}
          onChange={(event) => onEndpointIdChange(event.target.value)}
          disabled={loadingEndpoints || !hasConfiguredEndpoints}
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
        </UiSelect>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <UiSelect
            label="Provider"
            value={form.provider_hint}
            onChange={(event) => onFormChange("provider_hint", event.target.value)}
          >
            {S3_CONNECTION_PROVIDER_HINT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </UiSelect>
          <UiInput
            type="text"
            label="Region"
            value={form.region}
            onChange={(event) => onFormChange("region", event.target.value)}
            placeholder="us-east-1"
          />
          <UiInput
            type="url"
            label="Endpoint URL"
            fieldClassName="sm:col-span-2"
            value={form.endpoint_url}
            onChange={(event) => onFormChange("endpoint_url", event.target.value)}
            placeholder="https://s3.example.com"
          />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <UiCheckboxField
              checked={form.force_path_style}
              onChange={(event) => onFormChange("force_path_style", event.target.checked)}
              className={cx("ui-caption font-semibold", uiMutedTextClass)}
            >
              Force path style
            </UiCheckboxField>
            <UiCheckboxField
              checked={form.verify_tls}
              onChange={(event) => onFormChange("verify_tls", event.target.checked)}
              className={cx("ui-caption font-semibold", uiMutedTextClass)}
            >
              Verify TLS
            </UiCheckboxField>
          </div>
        </div>
      )}
      {errorMessage ? <p className="ui-caption text-amber-700 dark:text-amber-300">{errorMessage}</p> : null}
    </div>
  );
}
