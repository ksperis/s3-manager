/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type IamOverview = {
  iam_users: number;
  iam_groups: number;
  iam_roles: number;
  iam_policies: number;
  warnings?: string[];
};

export async function fetchIamOverview(accountId?: S3AccountSelector): Promise<IamOverview> {
  const { data } = await client.get<IamOverview>("/manager/iam/overview", {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}
