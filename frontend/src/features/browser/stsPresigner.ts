/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  PresignPartRequest,
  PresignPartResponse,
  PresignRequest,
  PresignedUrl,
  StsCredentials,
} from "../../api/browser";

const DEFAULT_EXPIRES_IN = 900;

const buildClient = (credentials: StsCredentials) =>
  new S3Client({
    region: credentials.region,
    endpoint: credentials.endpoint,
    credentials: {
      accessKeyId: credentials.access_key_id,
      secretAccessKey: credentials.secret_access_key,
      sessionToken: credentials.session_token,
    },
    forcePathStyle: true,
  });

const resolveExpires = (value?: number) => {
  if (value && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return DEFAULT_EXPIRES_IN;
};

export const presignObjectWithSts = async (
  credentials: StsCredentials,
  bucketName: string,
  payload: PresignRequest
): Promise<PresignedUrl> => {
  const client = buildClient(credentials);
  const expiresIn = resolveExpires(payload.expires_in);
  const headers: Record<string, string> = {};
  let method = "GET";
  if (payload.operation === "get_object") {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: payload.key,
      VersionId: payload.version_id ?? undefined,
    });
    const url = await getSignedUrl(client, command, { expiresIn });
    return { url, method, expires_in: expiresIn, headers: Object.keys(headers).length ? headers : undefined };
  }
  if (payload.operation === "delete_object") {
    method = "DELETE";
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: payload.key,
      VersionId: payload.version_id ?? undefined,
    });
    const url = await getSignedUrl(client, command, { expiresIn });
    return { url, method, expires_in: expiresIn, headers: Object.keys(headers).length ? headers : undefined };
  }
  if (payload.operation === "put_object") {
    method = "PUT";
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: payload.key,
      ContentType: payload.content_type ?? undefined,
    });
    if (payload.content_type) {
      headers["Content-Type"] = payload.content_type;
    }
    const url = await getSignedUrl(client, command, { expiresIn });
    return { url, method, expires_in: expiresIn, headers: Object.keys(headers).length ? headers : undefined };
  }
  if (payload.operation === "post_object") {
    method = "POST";
    const conditions: Array<Record<string, string> | [string, number, number]> = [];
    const fields: Record<string, string> = {};
    if (payload.content_type) {
      fields["Content-Type"] = payload.content_type;
      conditions.push({ "Content-Type": payload.content_type });
    }
    if (typeof payload.content_length === "number" && Number.isFinite(payload.content_length)) {
      conditions.push(["content-length-range", 0, Math.max(0, Math.floor(payload.content_length))]);
    }
    const result = await createPresignedPost(client, {
      Bucket: bucketName,
      Key: payload.key,
      Expires: expiresIn,
      Fields: Object.keys(fields).length ? fields : undefined,
      Conditions: conditions.length ? conditions : undefined,
    });
    return { url: result.url, method, expires_in: expiresIn, fields: result.fields };
  }
  throw new Error(`STS presign does not support ${payload.operation}`);
};

export const presignPartWithSts = async (
  credentials: StsCredentials,
  bucketName: string,
  uploadId: string,
  payload: PresignPartRequest
): Promise<PresignPartResponse> => {
  const client = buildClient(credentials);
  const expiresIn = resolveExpires(payload.expires_in);
  const command = new UploadPartCommand({
    Bucket: bucketName,
    Key: payload.key,
    PartNumber: payload.part_number,
    UploadId: uploadId,
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return { url, method: "PUT", expires_in: expiresIn };
};
