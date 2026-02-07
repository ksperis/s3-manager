/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type ApiTokenInfo = {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string | null;
  expires_at: string;
  revoked_at?: string | null;
};

export type CreateApiTokenPayload = {
  name: string;
  expires_in_days?: number;
};

export type CreateApiTokenResponse = {
  access_token: string;
  token_type: string;
  api_token: ApiTokenInfo;
};

export async function listApiTokens(includeRevoked = false): Promise<ApiTokenInfo[]> {
  const { data } = await client.get<ApiTokenInfo[]>("/auth/api-tokens", {
    params: {
      include_revoked: includeRevoked,
    },
  });
  return data;
}

export async function createApiToken(payload: CreateApiTokenPayload): Promise<CreateApiTokenResponse> {
  const { data } = await client.post<CreateApiTokenResponse>("/auth/api-tokens", payload);
  return data;
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  await client.delete(`/auth/api-tokens/${encodeURIComponent(tokenId)}`);
}
