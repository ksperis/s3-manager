/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import client from "./client";

export type UserNotificationSeverity = "info" | "warning" | "error";

export type UserNotification = {
  id: number;
  type: string;
  severity: UserNotificationSeverity;
  title: string;
  message: string;
  subject_type?: string | null;
  storage_endpoint_id?: number | null;
  s3_account_id?: number | null;
  s3_user_id?: number | null;
  payload?: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
};

type UserNotificationsResponse = {
  items: UserNotification[];
  unread_count: number;
};

type MarkUserNotificationsReadPayload = {
  notification_ids?: number[];
  all?: boolean;
};

type MarkUserNotificationsReadResponse = {
  updated_count: number;
  unread_count: number;
};

export async function fetchUserNotifications(limit = 20): Promise<UserNotificationsResponse> {
  const { data } = await client.get<UserNotificationsResponse>("/users/me/notifications", {
    params: { limit },
  });
  return data;
}

export async function markUserNotificationsRead(
  payload: MarkUserNotificationsReadPayload
): Promise<MarkUserNotificationsReadResponse> {
  const { data } = await client.post<MarkUserNotificationsReadResponse>("/users/me/notifications/read", payload);
  return data;
}
