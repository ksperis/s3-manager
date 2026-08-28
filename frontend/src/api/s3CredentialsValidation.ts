/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
export type S3CredentialsValidationPayload = {
  storage_endpoint_id?: number | null;
  endpoint_url?: string | null;
  region?: string | null;
  access_key_id: string;
  secret_access_key: string;
  force_path_style?: boolean;
  verify_tls?: boolean;
};

export type S3CredentialsValidationResult = {
  ok: boolean;
  severity: "success" | "warning" | "error";
  code?: string | null;
  message: string;
};
