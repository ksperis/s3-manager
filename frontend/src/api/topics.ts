/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";
import { S3AccountSelector, withS3AccountParam } from "./accountParams";

export type Topic = {
  name: string;
  arn: string;
  owner?: string | null;
  subscriptions_confirmed?: number | null;
  subscriptions_pending?: number | null;
  configuration?: Record<string, unknown> | null;
};

export type CreateTopicPayload = {
  name: string;
  configuration?: Record<string, unknown> | null;
};

export type TopicPolicy = {
  policy: Record<string, unknown>;
};

export type TopicConfiguration = {
  configuration: Record<string, unknown>;
};

export async function listTopics(accountId?: S3AccountSelector): Promise<Topic[]> {
  const { data } = await client.get<Topic[]>("/manager/topics", { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function createTopic(accountId: S3AccountSelector, payload: CreateTopicPayload): Promise<Topic> {
  const { data } = await client.post<Topic>("/manager/topics", payload, { params: withS3AccountParam(undefined, accountId) });
  return data;
}

export async function deleteTopic(accountId: S3AccountSelector, topicArn: string): Promise<void> {
  await client.delete(`/manager/topics/${encodeURIComponent(topicArn)}`, {
    params: withS3AccountParam(undefined, accountId),
  });
}

export async function getTopicPolicy(accountId: S3AccountSelector, topicArn: string): Promise<TopicPolicy> {
  const { data } = await client.get<TopicPolicy>(`/manager/topics/${encodeURIComponent(topicArn)}/policy`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updateTopicPolicy(
  accountId: S3AccountSelector,
  topicArn: string,
  policy: Record<string, unknown>
): Promise<TopicPolicy> {
  const { data } = await client.put<TopicPolicy>(
    `/manager/topics/${encodeURIComponent(topicArn)}/policy`,
    { policy },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}

export async function getTopicConfiguration(
  accountId: S3AccountSelector,
  topicArn: string
): Promise<TopicConfiguration> {
  const { data } = await client.get<TopicConfiguration>(`/manager/topics/${encodeURIComponent(topicArn)}/configuration`, {
    params: withS3AccountParam(undefined, accountId),
  });
  return data;
}

export async function updateTopicConfiguration(
  accountId: S3AccountSelector,
  topicArn: string,
  configuration: Record<string, unknown>
): Promise<TopicConfiguration> {
  const { data } = await client.put<TopicConfiguration>(
    `/manager/topics/${encodeURIComponent(topicArn)}/configuration`,
    { configuration },
    { params: withS3AccountParam(undefined, accountId) }
  );
  return data;
}
