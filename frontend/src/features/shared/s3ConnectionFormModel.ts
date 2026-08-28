/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3Connection } from "../../api/connections";
import { stableSignature } from "../../utils/stableSignature";
import { normalizeUiTags, type UiTagDefinition } from "../../utils/uiTags";
import type { S3CredentialsValidationPayload } from "./useLiveS3CredentialsValidation";

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

export function createDefaultPrivateConnectionForm(): CreatePrivateConnectionForm {
  return {
    name: "",
    tags: [],
    provider_hint: "",
    endpoint_url: "",
    region: "",
    access_key_id: "",
    secret_access_key: "",
    access_manager: false,
    access_browser: true,
    force_path_style: false,
    verify_tls: true,
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
  return stableSignature({
    endpointMode,
    endpointId,
    form: {
      ...form,
      tags: normalizeUiTags(form.tags),
    },
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
    if (!endpointId) return null;
    return {
      storage_endpoint_id: Number(endpointId),
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

export function parsePrivateConnectionSortDate(connection: S3Connection): number {
  const raw = connection.updated_at ?? connection.created_at;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}
