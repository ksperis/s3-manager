/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";
import type { S3Connection } from "../../api/connections";
import {
  buildCreatePrivateConnectionSignature,
  buildEditPrivateConnectionSignature,
  buildPrivateConnectionDraft,
  buildPrivateConnectionEditorState,
  buildS3CredentialsValidationPayload,
  createDefaultPrivateConnectionForm,
  createEmptyConnectionCredentialDraft,
  parsePrivateConnectionSortDate,
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
      buildCreatePrivateConnectionSignature(createForm, "custom", ""),
    ).toBe(
      buildCreatePrivateConnectionSignature(reversedCreateForm, "custom", ""),
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
});
