/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  CreateConnectionPayload,
  CredentialOwnerType,
  PrivateConnectionStorageEndpoint,
  S3Connection,
  UpdateConnectionPayload,
} from "../../api/connections";
import type {
  CreateAdminS3ConnectionPayload,
  UpdateAdminS3ConnectionPayload,
} from "../../api/s3ConnectionsAdmin";
import type { S3CredentialsValidationPayload } from "../../api/s3CredentialsValidation";
import { stableSignature } from "../../utils/stableSignature";
import {
  extractUiTagLabels,
  normalizeUiTags,
  type UiTagDefinition,
} from "../../utils/uiTags";

export type S3ConnectionEndpointMode = "preset" | "custom";

export type CreatePrivateConnectionForm = {
  name: string;
  tags: UiTagDefinition[];
  provider_hint: string;
  endpoint_url: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  access_manager: boolean;
  access_browser: boolean;
  force_path_style: boolean;
  verify_tls: boolean;
};

type CreateAdminS3ConnectionForm = {
  name: string;
  tags: UiTagDefinition[];
  provider_hint: string;
  endpoint_url: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  force_path_style: boolean;
  verify_tls: boolean;
};

export type EditAdminS3ConnectionForm = {
  name: string;
  tags: UiTagDefinition[];
  provider_hint: string;
  credential_owner_type: CredentialOwnerType | "";
  credential_owner_identifier: string;
  endpoint_url: string;
  region: string;
  force_path_style: boolean;
  verify_tls: boolean;
};

export type PrivateConnectionDraft = {
  name: string;
  tags: UiTagDefinition[];
  provider_hint: string;
  endpoint_url: string;
  region: string;
  access_manager: boolean;
  access_browser: boolean;
  force_path_style: boolean;
  verify_tls: boolean;
  storage_endpoint_id?: number | null;
};

export type ConnectionCredentialDraft = {
  access_key_id: string;
  secret_access_key: string;
};

type S3CredentialsFormFields = {
  endpoint_url: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  force_path_style: boolean;
  verify_tls: boolean;
};

type PrivateConnectionEditorState = {
  drafts: Record<number, PrivateConnectionDraft>;
  credentialDrafts: Record<number, ConnectionCredentialDraft>;
};

type BuildPrivateConnectionsProjectionOptions = {
  connections: readonly S3Connection[];
  filter: string;
  page: number;
  pageSize: number;
  selectedConnectionIds: readonly number[];
};

type PreparedConnectionPayload<T> =
  | { error: null; payload: T }
  | { error: string; payload: null };

type PreparePrivateConnectionUpdateOptions = {
  canManageCredentials: boolean;
  credentialDraft: ConnectionCredentialDraft;
  draft: PrivateConnectionDraft;
  endpointId: string;
  endpointMode: S3ConnectionEndpointMode;
  serverManaged: boolean;
};

type PrepareAdminS3ConnectionUpdateOptions = {
  credentialDraft: ConnectionCredentialDraft;
  endpointId: string;
  endpointMode: S3ConnectionEndpointMode;
  form: EditAdminS3ConnectionForm;
  linkedGroupIds: readonly number[];
  linkedUserIds: readonly number[];
};

type BuildAdminS3ConnectionEditSignatureOptions = {
  credentialDraft: ConnectionCredentialDraft;
  endpointId: string;
  endpointMode: S3ConnectionEndpointMode;
  form: EditAdminS3ConnectionForm;
  linkedGroupIds: readonly number[];
  linkedUserIds: readonly number[];
};

type PrivateConnectionsProjection = {
  allFilteredConnectionsSelected: boolean;
  filteredConnectionIdSet: Set<number>;
  filteredConnectionIds: number[];
  filteredConnections: S3Connection[];
  hiddenSelectedConnectionCount: number;
  pagedConnectionIds: number[];
  pagedConnections: S3Connection[];
  selectedFilteredConnectionIdSet: Set<number>;
  selectedFilteredConnectionIds: number[];
  selectedPagedConnectionIds: number[];
};

function createDefaultS3ConnectionFormFields(): CreateAdminS3ConnectionForm {
  return {
    name: "",
    tags: [],
    provider_hint: "",
    endpoint_url: "",
    region: "",
    access_key_id: "",
    secret_access_key: "",
    force_path_style: false,
    verify_tls: true,
  };
}

export function createDefaultAdminS3ConnectionForm(): CreateAdminS3ConnectionForm {
  return createDefaultS3ConnectionFormFields();
}

export function createDefaultPrivateConnectionForm(): CreatePrivateConnectionForm {
  return {
    ...createDefaultS3ConnectionFormFields(),
    access_manager: false,
    access_browser: true,
  };
}

export function createEmptyConnectionCredentialDraft(): ConnectionCredentialDraft {
  return { access_key_id: "", secret_access_key: "" };
}

export function buildPrivateConnectionDraft(
  connection: S3Connection,
): PrivateConnectionDraft {
  return {
    name: connection.name ?? "",
    tags: normalizeUiTags(connection.tags),
    provider_hint: connection.provider_hint ?? "",
    endpoint_url: connection.endpoint_url ?? "",
    region: connection.region ?? "",
    access_manager: connection.access_manager === true,
    access_browser: connection.access_browser !== false,
    force_path_style: Boolean(connection.force_path_style),
    verify_tls: connection.verify_tls !== false,
    storage_endpoint_id: connection.storage_endpoint_id ?? null,
  };
}

export function buildPrivateConnectionEditorState(
  connections: readonly S3Connection[],
): PrivateConnectionEditorState {
  const drafts: Record<number, PrivateConnectionDraft> = {};
  const credentialDrafts: Record<number, ConnectionCredentialDraft> = {};
  connections.forEach((connection) => {
    drafts[connection.id] = buildPrivateConnectionDraft(connection);
    credentialDrafts[connection.id] = createEmptyConnectionCredentialDraft();
  });
  return { credentialDrafts, drafts };
}

export function buildCreatePrivateConnectionSignature(
  form: CreatePrivateConnectionForm,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): string {
  return buildS3ConnectionFormSignature(form, endpointMode, endpointId);
}

export function buildCreateAdminS3ConnectionSignature(
  form: CreateAdminS3ConnectionForm,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): string {
  return buildS3ConnectionFormSignature(form, endpointMode, endpointId);
}

function buildS3ConnectionFormSignature<T extends { tags: UiTagDefinition[] }>(
  form: T,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): string {
  return stableSignature({
    endpointMode,
    endpointId,
    form: {
      ...form,
      tags: normalizeUiTags(form.tags),
    },
  });
}

export function buildEditAdminS3ConnectionSignature({
  credentialDraft,
  endpointId,
  endpointMode,
  form,
  linkedGroupIds,
  linkedUserIds,
}: BuildAdminS3ConnectionEditSignatureOptions): string {
  return stableSignature({
    endpointMode,
    endpointId,
    form: {
      ...form,
      tags: normalizeUiTags(form.tags),
    },
    credentialDraft,
    linkedGroupIds: normalizeS3ConnectionLinkedIds(linkedGroupIds),
    linkedUserIds: normalizeS3ConnectionLinkedIds(linkedUserIds),
  });
}

export function buildEditPrivateConnectionSignature(
  draft: PrivateConnectionDraft,
  credentialDraft: ConnectionCredentialDraft,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): string {
  return stableSignature({
    endpointMode,
    endpointId,
    draft: {
      ...draft,
      tags: normalizeUiTags(draft.tags),
    },
    credentialDraft,
  });
}

export function buildS3CredentialsValidationPayload(
  form: S3CredentialsFormFields,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): S3CredentialsValidationPayload | null {
  const accessKeyId = form.access_key_id.trim();
  const secretAccessKey = form.secret_access_key.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  if (endpointMode === "preset") {
    const parsedEndpointId = parseS3ConnectionEndpointId(endpointId);
    if (parsedEndpointId === null) return null;
    return {
      storage_endpoint_id: parsedEndpointId,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
    };
  }
  const endpointUrl = form.endpoint_url.trim();
  if (!endpointUrl) return null;
  return {
    endpoint_url: endpointUrl,
    region: form.region.trim() || null,
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    force_path_style: form.force_path_style,
    verify_tls: form.verify_tls,
  };
}

function parseS3ConnectionEndpointId(endpointId: string): number | null {
  const parsed = Number(endpointId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function invalidConnectionPayload<T>(
  error: string,
): PreparedConnectionPayload<T> {
  return { error, payload: null };
}

export function prepareCreatePrivateConnectionPayload(
  form: CreatePrivateConnectionForm,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): PreparedConnectionPayload<CreateConnectionPayload> {
  if (!form.name.trim()) {
    return invalidConnectionPayload("Connection name is required.");
  }
  const parsedEndpointId =
    endpointMode === "preset" ? parseS3ConnectionEndpointId(endpointId) : null;
  if (endpointMode === "preset" && parsedEndpointId === null) {
    return invalidConnectionPayload("Select a configured endpoint.");
  }
  if (endpointMode === "custom" && !form.endpoint_url.trim()) {
    return invalidConnectionPayload("Endpoint URL is required.");
  }
  if (!form.access_key_id.trim() || !form.secret_access_key.trim()) {
    return invalidConnectionPayload("S3 credentials are required.");
  }
  if (!form.access_manager && !form.access_browser) {
    return invalidConnectionPayload("Enable access to manager and/or browser.");
  }

  const endpointPayload =
    endpointMode === "preset"
      ? { storage_endpoint_id: parsedEndpointId }
      : {
          storage_endpoint_id: null,
          provider_hint: form.provider_hint.trim() || undefined,
          endpoint_url: form.endpoint_url.trim(),
          region: form.region.trim() || undefined,
          force_path_style: form.force_path_style,
          verify_tls: form.verify_tls,
        };
  return {
    error: null,
    payload: {
      name: form.name.trim(),
      tags: normalizeUiTags(form.tags),
      access_key_id: form.access_key_id.trim(),
      secret_access_key: form.secret_access_key,
      access_manager: form.access_manager,
      access_browser: form.access_browser,
      ...endpointPayload,
    },
  };
}

export function prepareCreateAdminS3ConnectionPayload(
  form: CreateAdminS3ConnectionForm,
  endpointMode: S3ConnectionEndpointMode,
  endpointId: string,
): PreparedConnectionPayload<CreateAdminS3ConnectionPayload> {
  if (!form.name.trim()) {
    return invalidConnectionPayload("Connection name is required.");
  }
  const parsedEndpointId =
    endpointMode === "preset" ? parseS3ConnectionEndpointId(endpointId) : null;
  if (endpointMode === "preset" && parsedEndpointId === null) {
    return invalidConnectionPayload("Select a configured endpoint.");
  }
  if (endpointMode === "custom" && !form.endpoint_url.trim()) {
    return invalidConnectionPayload("Endpoint URL is required.");
  }
  if (!form.access_key_id.trim() || !form.secret_access_key) {
    return invalidConnectionPayload("S3 credentials are required.");
  }

  const endpointPayload =
    endpointMode === "preset"
      ? { storage_endpoint_id: parsedEndpointId }
      : {
          storage_endpoint_id: null,
          provider_hint: form.provider_hint.trim() || null,
          endpoint_url: form.endpoint_url.trim(),
          region: form.region.trim() || null,
          force_path_style: form.force_path_style,
          verify_tls: form.verify_tls,
        };
  return {
    error: null,
    payload: {
      name: form.name.trim(),
      tags: normalizeUiTags(form.tags),
      access_key_id: form.access_key_id.trim(),
      secret_access_key: form.secret_access_key,
      ...endpointPayload,
    },
  };
}

export function normalizeS3ConnectionLinkedIds(
  ids: readonly number[] | undefined,
): number[] {
  return Array.from(new Set((ids ?? []).map((id) => Number(id))))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((left, right) => left - right);
}

export function parseS3ConnectionCredentialOwnerType(
  value: string,
): CredentialOwnerType | "" {
  switch (value) {
    case "iam_user":
    case "account_user":
    case "s3_user":
      return value;
    default:
      return "";
  }
}

export function prepareUpdateAdminS3ConnectionPayload({
  credentialDraft,
  endpointId,
  endpointMode,
  form,
  linkedGroupIds,
  linkedUserIds,
}: PrepareAdminS3ConnectionUpdateOptions): PreparedConnectionPayload<UpdateAdminS3ConnectionPayload> {
  if (!form.name.trim()) {
    return invalidConnectionPayload("Connection name is required.");
  }
  const parsedEndpointId =
    endpointMode === "preset" ? parseS3ConnectionEndpointId(endpointId) : null;
  if (endpointMode === "preset" && parsedEndpointId === null) {
    return invalidConnectionPayload("Select a configured endpoint.");
  }
  if (endpointMode === "custom" && !form.endpoint_url.trim()) {
    return invalidConnectionPayload("Endpoint URL is required.");
  }
  const accessKeyId = credentialDraft.access_key_id.trim();
  const secretAccessKey = credentialDraft.secret_access_key.trim();
  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    return invalidConnectionPayload(
      "Provide both access key ID and secret access key to update credentials.",
    );
  }

  const endpointPayload =
    endpointMode === "preset"
      ? { storage_endpoint_id: parsedEndpointId }
      : {
          storage_endpoint_id: null,
          provider_hint: form.provider_hint.trim() || null,
          endpoint_url: form.endpoint_url.trim(),
          region: form.region.trim() || null,
          force_path_style: form.force_path_style,
          verify_tls: form.verify_tls,
        };
  return {
    error: null,
    payload: {
      name: form.name.trim(),
      group_ids: normalizeS3ConnectionLinkedIds(linkedGroupIds),
      user_ids: normalizeS3ConnectionLinkedIds(linkedUserIds),
      tags: normalizeUiTags(form.tags),
      credential_owner_type: form.credential_owner_type || null,
      credential_owner_identifier:
        form.credential_owner_identifier.trim() || null,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              access_key_id: accessKeyId,
              secret_access_key: secretAccessKey,
            }
          : null,
      ...endpointPayload,
    },
  };
}

export function prepareUpdatePrivateConnectionPayload({
  canManageCredentials,
  credentialDraft,
  draft,
  endpointId,
  endpointMode,
  serverManaged,
}: PreparePrivateConnectionUpdateOptions): PreparedConnectionPayload<UpdateConnectionPayload> {
  if (!draft.name.trim()) {
    return invalidConnectionPayload("Connection name is required.");
  }
  const endpointEditable = canManageCredentials && !serverManaged;
  const parsedEndpointId =
    endpointMode === "preset" ? parseS3ConnectionEndpointId(endpointId) : null;
  if (endpointEditable && endpointMode === "preset" && parsedEndpointId === null) {
    return invalidConnectionPayload("Select a configured endpoint.");
  }
  if (endpointEditable && endpointMode === "custom" && !draft.endpoint_url.trim()) {
    return invalidConnectionPayload("Endpoint URL is required.");
  }
  if (!draft.access_manager && !draft.access_browser) {
    return invalidConnectionPayload("Enable access to manager and/or browser.");
  }
  const accessKeyId = credentialDraft.access_key_id.trim();
  const secretAccessKey = credentialDraft.secret_access_key.trim();
  if (
    endpointEditable &&
    ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey))
  ) {
    return invalidConnectionPayload(
      "Provide both access key ID and secret access key to update credentials.",
    );
  }

  const endpointPayload = !endpointEditable
    ? {}
    : endpointMode === "preset"
      ? { storage_endpoint_id: parsedEndpointId }
      : {
          storage_endpoint_id: null,
          provider_hint: draft.provider_hint.trim() || undefined,
          endpoint_url: draft.endpoint_url.trim(),
          region: draft.region.trim() || undefined,
          force_path_style: draft.force_path_style,
          verify_tls: draft.verify_tls,
        };
  return {
    error: null,
    payload: {
      name: draft.name.trim(),
      tags: normalizeUiTags(draft.tags),
      access_manager: draft.access_manager,
      access_browser: draft.access_browser,
      ...endpointPayload,
      ...(endpointEditable && accessKeyId && secretAccessKey
        ? {
            access_key_id: accessKeyId,
            secret_access_key: secretAccessKey,
          }
        : {}),
    },
  };
}

export function parsePrivateConnectionSortDate(connection: S3Connection): number {
  const raw = connection.updated_at ?? connection.created_at;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildPrivateConnectionsProjection({
  connections,
  filter,
  page,
  pageSize,
  selectedConnectionIds,
}: BuildPrivateConnectionsProjectionOptions): PrivateConnectionsProjection {
  const sortedConnections = [...connections].sort((a, b) => {
    const dateDiff =
      parsePrivateConnectionSortDate(b) - parsePrivateConnectionSortDate(a);
    return dateDiff !== 0 ? dateDiff : b.id - a.id;
  });
  const query = filter.trim().toLowerCase();
  const filteredConnections = query
    ? sortedConnections.filter((connection) => {
        const values = [
          connection.name,
          ...extractUiTagLabels(connection.tags),
          connection.endpoint_url,
          connection.region,
          connection.provider_hint,
          connection.access_key_id,
        ];
        return values.some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query),
        );
      })
    : sortedConnections;
  const start = (page - 1) * pageSize;
  const pagedConnections = filteredConnections.slice(start, start + pageSize);
  const filteredConnectionIds = filteredConnections.map(
    (connection) => connection.id,
  );
  const filteredConnectionIdSet = new Set(filteredConnectionIds);
  const pagedConnectionIds = pagedConnections.map(
    (connection) => connection.id,
  );
  const selectedFilteredConnectionIds = selectedConnectionIds.filter(
    (connectionId) => filteredConnectionIdSet.has(connectionId),
  );
  const selectedFilteredConnectionIdSet = new Set(
    selectedFilteredConnectionIds,
  );
  const selectedPagedConnectionIds = pagedConnectionIds.filter((connectionId) =>
    selectedFilteredConnectionIdSet.has(connectionId),
  );
  return {
    allFilteredConnectionsSelected:
      filteredConnectionIds.length > 0 &&
      selectedFilteredConnectionIds.length === filteredConnectionIds.length,
    filteredConnectionIdSet,
    filteredConnectionIds,
    filteredConnections,
    hiddenSelectedConnectionCount: Math.max(
      selectedFilteredConnectionIds.length - selectedPagedConnectionIds.length,
      0,
    ),
    pagedConnectionIds,
    pagedConnections,
    selectedFilteredConnectionIdSet,
    selectedFilteredConnectionIds,
    selectedPagedConnectionIds,
  };
}

export function buildPrivateStorageEndpointLabelById(
  endpoints: readonly PrivateConnectionStorageEndpoint[],
): Map<number, string> {
  return new Map(
    endpoints.map((endpoint) => [
      endpoint.id,
      endpoint.name?.trim() ||
        endpoint.endpoint_url ||
        `Endpoint #${endpoint.id}`,
    ]),
  );
}
