/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { S3AccountSelector } from "./accountParams";
import { withS3AccountParam } from "./accountParams";
import type { StsCredentials, StsStatus } from "./browserContracts";
import { buildBrowserWorkspaceHeaders } from "./browserRequestHeaders";
import type { BrowserRequestOptions } from "./browserWorkspace";
import client from "./client";

export async function getBrowserStsStatus(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<StsStatus> {
  const { data } = await client.get<StsStatus>("/browser/sts", {
    params: withS3AccountParam(undefined, accountId),
    headers: buildBrowserWorkspaceHeaders(options),
  });
  return data;
}

export async function getBrowserStsCredentials(
  accountId: S3AccountSelector,
  options?: BrowserRequestOptions,
): Promise<StsCredentials> {
  const { data } = await client.get<StsCredentials>(
    "/browser/sts/credentials",
    {
      params: withS3AccountParam(undefined, accountId),
      headers: buildBrowserWorkspaceHeaders(options),
    },
  );
  return data;
}
