/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { S3Connection } from "../../api/connections";
import {
  buildCreateS3ConnectionSignature,
  buildEditAdminS3ConnectionSignature,
  buildEditPrivateConnectionSignature,
  buildPrivateConnectionDraft,
  buildPrivateConnectionEditorState,
  buildPrivateConnectionsProjection,
  buildPrivateStorageEndpointLabelById,
  buildS3CredentialsValidationPayload,
  createDefaultAdminS3ConnectionForm,
  createDefaultPrivateConnectionForm,
  createEmptyConnectionCredentialDraft,
  normalizeS3ConnectionLinkedIds,
  parseS3ConnectionCredentialOwnerType,
  parsePrivateConnectionSortDate,
  prepareCreateAdminS3ConnectionPayload,
  prepareCreatePrivateConnectionPayload,
  prepareUpdateAdminS3ConnectionPayload,
  prepareUpdatePrivateConnectionPayload,
} from "./s3ConnectionFormModel";

const connection: S3Connection = {
  id: 7,
  name: "Archive",
  tags: [
    { id: "tag-b", label: "Beta", color: "blue" },
    { id: "tag-a", label: "Alpha", color: "red" },
  ],
  provider_hint: null,
  endpoint_url: "https://s3.example.test",
  region: null,
  access_manager: true,
  access_browser: false,
  force_path_style: true,
  verify_tls: false,
  storage_endpoint_id: 3,
  created_at: "2026-08-20T10:00:00Z",
  updated_at: "2026-08-22T10:00:00Z",
};

describe("s3ConnectionFormModel", () => {
  it("creates isolated private connection defaults", () => {
    const first = createDefaultPrivateConnectionForm();
    const second = createDefaultPrivateConnectionForm();

    expect(first).toMatchObject({
      access_manager: false,
      access_browser: true,
      force_path_style: false,
      verify_tls: true,
    });
    expect(first.tags).not.toBe(second.tags);
  });

  it("creates isolated Admin connection defaults from the shared fields", () => {
    const first = createDefaultAdminS3ConnectionForm();
    const second = createDefaultAdminS3ConnectionForm();

    expect(first).toEqual({
      name: "",
      tags: [],
      provider_hint: "",
      endpoint_url: "",
      region: "",
      access_key_id: "",
      secret_access_key: "",
      force_path_style: false,
      verify_tls: true,
    });
    expect(first.tags).not.toBe(second.tags);
  });

  it("builds canonical drafts and isolated editor credentials", () => {
    const draft = buildPrivateConnectionDraft(connection);
    expect(draft).toMatchObject({
      name: "Archive",
      provider_hint: "",
      region: "",
      access_manager: true,
      access_browser: false,
      force_path_style: true,
      verify_tls: false,
      storage_endpoint_id: 3,
    });

    const editorState = buildPrivateConnectionEditorState([
      connection,
      { ...connection, id: 8, name: "Replica" },
    ]);
    expect(editorState.drafts[8].name).toBe("Replica");
    expect(editorState.credentialDrafts[7]).toEqual(
      createEmptyConnectionCredentialDraft(),
    );
    expect(editorState.credentialDrafts[7]).not.toBe(
      editorState.credentialDrafts[8],
    );
  });

  it("normalizes tags in create and edit dirty signatures", () => {
    const createForm = createDefaultPrivateConnectionForm();
    createForm.tags = connection.tags ?? [];
    const reversedCreateForm = {
      ...createForm,
      tags: [...createForm.tags].reverse(),
    };
    expect(
      buildCreateS3ConnectionSignature(createForm, "custom", ""),
    ).toBe(
      buildCreateS3ConnectionSignature(reversedCreateForm, "custom", ""),
    );

    const draft = buildPrivateConnectionDraft(connection);
    expect(
      buildEditPrivateConnectionSignature(
        draft,
        createEmptyConnectionCredentialDraft(),
        "preset",
        "3",
      ),
    ).toBe(
      buildEditPrivateConnectionSignature(
        { ...draft, tags: [...draft.tags].reverse() },
        createEmptyConnectionCredentialDraft(),
        "preset",
        "3",
      ),
    );

    const adminForm = {
      ...createDefaultAdminS3ConnectionForm(),
      tags: connection.tags ?? [],
    };
    expect(
      buildCreateS3ConnectionSignature(adminForm, "custom", ""),
    ).toBe(
      buildCreateS3ConnectionSignature(
        { ...adminForm, tags: [...adminForm.tags].reverse() },
        "custom",
        "",
      ),
    );
    const editAdminForm = {
      name: "Archive",
      tags: adminForm.tags,
      provider_hint: "",
      credential_owner_type: "" as const,
      credential_owner_identifier: "",
      endpoint_url: "https://s3.example.test",
      region: "",
      force_path_style: false,
      verify_tls: true,
    };
    expect(
      buildEditAdminS3ConnectionSignature({
        credentialDraft: createEmptyConnectionCredentialDraft(),
        endpointId: "",
        endpointMode: "custom",
        form: editAdminForm,
        linkedGroupIds: [8, 3],
        linkedUserIds: [5, 2],
      }),
    ).toBe(
      buildEditAdminS3ConnectionSignature({
        credentialDraft: createEmptyConnectionCredentialDraft(),
        endpointId: "",
        endpointMode: "custom",
        form: { ...editAdminForm, tags: [...editAdminForm.tags].reverse() },
        linkedGroupIds: [3, 8],
        linkedUserIds: [2, 5],
      }),
    );
  });

  it("builds canonical preset and custom credential validation payloads", () => {
    const form = {
      ...createDefaultPrivateConnectionForm(),
      endpoint_url: " https://s3.example.test ",
      region: " eu-west-1 ",
      access_key_id: " access ",
      secret_access_key: " secret ",
      force_path_style: true,
      verify_tls: false,
    };

    expect(buildS3CredentialsValidationPayload(form, "preset", "3")).toEqual({
      storage_endpoint_id: 3,
      access_key_id: "access",
      secret_access_key: "secret",
    });
    expect(buildS3CredentialsValidationPayload(form, "custom", "")).toEqual({
      endpoint_url: "https://s3.example.test",
      region: "eu-west-1",
      access_key_id: "access",
      secret_access_key: "secret",
      force_path_style: true,
      verify_tls: false,
    });
    expect(
      buildS3CredentialsValidationPayload(
        { ...form, secret_access_key: "" },
        "custom",
        "",
      ),
    ).toBeNull();
    expect(buildS3CredentialsValidationPayload(form, "preset", "invalid")).toBeNull();
  });

  it("prepares canonical private connection create payloads", () => {
    const form = {
      ...createDefaultPrivateConnectionForm(),
      name: " Archive ",
      endpoint_url: " https://s3.example.test ",
      region: " eu-west-1 ",
      access_key_id: " access ",
      secret_access_key: " secret with spaces ",
      access_manager: true,
      force_path_style: true,
    };

    expect(prepareCreatePrivateConnectionPayload(form, "custom", "")).toEqual({
      error: null,
      payload: {
        name: "Archive",
        tags: [],
        storage_endpoint_id: null,
        endpoint_url: "https://s3.example.test",
        region: "eu-west-1",
        provider_hint: undefined,
        access_key_id: "access",
        secret_access_key: " secret with spaces ",
        access_manager: true,
        access_browser: true,
        force_path_style: true,
        verify_tls: true,
      },
    });
    expect(prepareCreatePrivateConnectionPayload(form, "preset", "3")).toEqual({
      error: null,
      payload: expect.objectContaining({
        name: "Archive",
        storage_endpoint_id: 3,
      }),
    });
    expect(
      prepareCreatePrivateConnectionPayload(
        { ...form, name: "" },
        "custom",
        "",
      ),
    ).toEqual({ error: "Connection name is required.", payload: null });
    expect(prepareCreatePrivateConnectionPayload(form, "preset", "invalid")).toEqual({
      error: "Select a configured endpoint.",
      payload: null,
    });
  });

  it("prepares canonical Admin connection create payloads", () => {
    const form = {
      ...createDefaultAdminS3ConnectionForm(),
      name: " Shared archive ",
      provider_hint: " aws ",
      endpoint_url: " https://s3.example.test ",
      region: " eu-west-1 ",
      access_key_id: " access ",
      secret_access_key: " secret with spaces ",
      force_path_style: true,
    };

    expect(prepareCreateAdminS3ConnectionPayload(form, "custom", "")).toEqual({
      error: null,
      payload: {
        name: "Shared archive",
        tags: [],
        storage_endpoint_id: null,
        provider_hint: "aws",
        endpoint_url: "https://s3.example.test",
        region: "eu-west-1",
        access_key_id: "access",
        secret_access_key: " secret with spaces ",
        force_path_style: true,
        verify_tls: true,
      },
    });
    expect(prepareCreateAdminS3ConnectionPayload(form, "preset", "3")).toEqual({
      error: null,
      payload: {
        name: "Shared archive",
        tags: [],
        storage_endpoint_id: 3,
        access_key_id: "access",
        secret_access_key: " secret with spaces ",
      },
    });
    expect(prepareCreateAdminS3ConnectionPayload(form, "preset", "invalid")).toEqual({
      error: "Select a configured endpoint.",
      payload: null,
    });
  });

  it("prepares canonical Admin connection updates and credential rotation", () => {
    const prepared = prepareUpdateAdminS3ConnectionPayload({
      credentialDraft: {
        access_key_id: " replacement-access ",
        secret_access_key: " replacement-secret ",
      },
      endpointId: "",
      endpointMode: "custom",
      form: {
        name: " Shared archive ",
        tags: connection.tags ?? [],
        provider_hint: " aws ",
        credential_owner_type: "iam_user",
        credential_owner_identifier: " owner-1 ",
        endpoint_url: " https://updated.example.test ",
        region: " eu-west-3 ",
        force_path_style: true,
        verify_tls: false,
      },
      linkedGroupIds: [8, 3, 8, -1],
      linkedUserIds: [11, 7, 11, 0],
    });

    expect(prepared).toEqual({
      error: null,
      payload: {
        name: "Shared archive",
        group_ids: [3, 8],
        user_ids: [7, 11],
        tags: [
          expect.objectContaining({ label: "Beta" }),
          expect.objectContaining({ label: "Alpha" }),
        ],
        credential_owner_type: "iam_user",
        credential_owner_identifier: "owner-1",
        credentials: {
          access_key_id: "replacement-access",
          secret_access_key: "replacement-secret",
        },
        storage_endpoint_id: null,
        provider_hint: "aws",
        endpoint_url: "https://updated.example.test",
        region: "eu-west-3",
        force_path_style: true,
        verify_tls: false,
      },
    });
    expect(
      prepareUpdateAdminS3ConnectionPayload({
        credentialDraft: {
          access_key_id: "replacement-access",
          secret_access_key: "",
        },
        endpointId: "3",
        endpointMode: "preset",
        form: {
          name: "Shared archive",
          tags: [],
          provider_hint: "",
          credential_owner_type: "",
          credential_owner_identifier: "",
          endpoint_url: "",
          region: "",
          force_path_style: false,
          verify_tls: true,
        },
        linkedGroupIds: [],
        linkedUserIds: [],
      }),
    ).toEqual({
      error: "Provide both access key ID and secret access key to update credentials.",
      payload: null,
    });
    expect(normalizeS3ConnectionLinkedIds([4, Number.NaN, 2, 4, 0])).toEqual([2, 4]);
    expect(parseS3ConnectionCredentialOwnerType("invalid")).toBe("");
  });

  it("prepares editable and server-managed private connection updates", () => {
    const draft = buildPrivateConnectionDraft(connection);
    const editable = prepareUpdatePrivateConnectionPayload({
      canManageCredentials: true,
      credentialDraft: {
        access_key_id: " new-access ",
        secret_access_key: " new-secret ",
      },
      draft: { ...draft, endpoint_url: " https://updated.example.test " },
      endpointId: "",
      endpointMode: "custom",
      serverManaged: false,
    });
    expect(editable).toEqual({
      error: null,
      payload: expect.objectContaining({
        name: "Archive",
        storage_endpoint_id: null,
        endpoint_url: "https://updated.example.test",
        access_key_id: "new-access",
        secret_access_key: "new-secret",
      }),
    });

    const managed = prepareUpdatePrivateConnectionPayload({
      canManageCredentials: true,
      credentialDraft: {
        access_key_id: "ignored",
        secret_access_key: "ignored",
      },
      draft: { ...draft, endpoint_url: "" },
      endpointId: "",
      endpointMode: "custom",
      serverManaged: true,
    });
    expect(managed).toEqual({
      error: null,
      payload: {
        name: "Archive",
        tags: draft.tags,
        access_manager: true,
        access_browser: false,
      },
    });

    expect(
      prepareUpdatePrivateConnectionPayload({
        canManageCredentials: true,
        credentialDraft: {
          access_key_id: "access-only",
          secret_access_key: "",
        },
        draft,
        endpointId: "3",
        endpointMode: "preset",
        serverManaged: false,
      }),
    ).toEqual({
      error: "Provide both access key ID and secret access key to update credentials.",
      payload: null,
    });
  });

  it("uses the updated timestamp before the creation timestamp", () => {
    expect(parsePrivateConnectionSortDate(connection)).toBe(
      Date.parse("2026-08-22T10:00:00Z"),
    );
    expect(
      parsePrivateConnectionSortDate({
        ...connection,
        updated_at: "invalid",
      }),
    ).toBe(0);
  });

  it("projects sorted, filtered, paged, and selected private connections", () => {
    const olderConnection = {
      ...connection,
      id: 8,
      name: "Replica",
      tags: [],
      updated_at: "2026-08-21T10:00:00Z",
    };
    const projection = buildPrivateConnectionsProjection({
      connections: [olderConnection, connection],
      filter: "",
      page: 1,
      pageSize: 1,
      selectedConnectionIds: [7, 8, 99],
    });

    expect(projection.filteredConnectionIds).toEqual([7, 8]);
    expect(projection.pagedConnectionIds).toEqual([7]);
    expect(projection.selectedFilteredConnectionIds).toEqual([7, 8]);
    expect(projection.selectedPagedConnectionIds).toEqual([7]);
    expect(projection.hiddenSelectedConnectionCount).toBe(1);
    expect(projection.allFilteredConnectionsSelected).toBe(true);

    const filtered = buildPrivateConnectionsProjection({
      connections: [olderConnection, connection],
      filter: "alpha",
      page: 1,
      pageSize: 10,
      selectedConnectionIds: [],
    });
    expect(filtered.filteredConnectionIds).toEqual([7]);
  });

  it("builds stable labels for private storage endpoints", () => {
    expect(
      buildPrivateStorageEndpointLabelById([
        {
          id: 3,
          name: " Primary ",
          endpoint_url: "https://primary.example.test",
          region: null,
          is_default: true,
        },
        {
          id: 4,
          name: "",
          endpoint_url: "https://secondary.example.test",
          region: null,
          is_default: false,
        },
      ]),
    ).toEqual(
      new Map([
        [3, "Primary"],
        [4, "https://secondary.example.test"],
      ]),
    );
  });
});
