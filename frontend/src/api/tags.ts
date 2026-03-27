/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export const TAG_COLOR_KEYS = [
  "neutral",
  "slate",
  "gray",
  "zinc",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;
export const TAG_SCOPES = ["administrative", "standard"] as const;

export type TagColorKey = (typeof TAG_COLOR_KEYS)[number];
export type TagScope = (typeof TAG_SCOPES)[number];
export type TagCatalogDomain = "admin_managed" | "endpoint";

export type TagDefinitionSummary = {
  id: number;
  label: string;
  color_key: TagColorKey;
  scope: TagScope;
};

export type TagDefinitionInput = {
  label: string;
  color_key: TagColorKey;
  scope: TagScope;
};

type TagDefinitionListResponse = {
  items: TagDefinitionSummary[];
};

export async function listAdminTagDefinitions(domain: TagCatalogDomain): Promise<TagDefinitionSummary[]> {
  const { data } = await client.get<TagDefinitionListResponse>("/admin/tag-definitions", {
    params: { domain },
  });
  return data.items;
}

export async function listPrivateConnectionTagDefinitions(): Promise<TagDefinitionSummary[]> {
  const { data } = await client.get<TagDefinitionListResponse>("/connections/tag-definitions");
  return data.items;
}
