/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3Account } from "./accounts";

export async function listManagerS3Accounts(): Promise<S3Account[]> {
  const { data } = await client.get<S3Account[]>("/manager/accounts");
  return data;
}
