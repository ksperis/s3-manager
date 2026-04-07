import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

async function ensureBucket(client, bucketName) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }
}

async function emptyBucket(client, bucketName) {
  let keyMarker;
  let versionIdMarker;

  for (;;) {
    const response = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );

    const objects = [
      ...(response.Versions ?? []).map((entry) => ({
        Key: entry.Key,
        VersionId: entry.VersionId,
      })),
      ...(response.DeleteMarkers ?? []).map((entry) => ({
        Key: entry.Key,
        VersionId: entry.VersionId,
      })),
    ].filter((entry) => entry.Key);

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: {
            Objects: objects,
            Quiet: true,
          },
        }),
      );
    }

    if (!response.IsTruncated) {
      return;
    }
    keyMarker = response.NextKeyMarker;
    versionIdMarker = response.NextVersionIdMarker;
  }
}

async function putTextObject(client, bucketName, key, body, contentType, metadata = undefined) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }),
  );
}

export async function seedMoto({
  endpoint = process.env.E2E_S3_ENDPOINT ?? "http://localhost:5000",
  accessKeyId = process.env.E2E_S3_ACCESS_KEY ?? "minio",
  secretAccessKey = process.env.E2E_S3_SECRET_KEY ?? "minio123",
  region = process.env.E2E_S3_REGION ?? "us-east-1",
  bucketName = process.env.E2E_BUCKET_NAME ?? "browser-e2e",
} = {}) {
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  await ensureBucket(client, bucketName);
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  await emptyBucket(client, bucketName);

  await putTextObject(
    client,
    bucketName,
    "navigation/daily/report-2026-03-08.json",
    JSON.stringify({ report: "ok", generated_at: "2026-03-08T07:15:00Z" }, null, 2),
    "application/json",
    { source: "e2e" },
  );
  await putTextObject(
    client,
    bucketName,
    "navigation/daily/errors-2026-03-08.log",
    "error: none\n",
    "text/plain",
  );
  await putTextObject(
    client,
    bucketName,
    "delete/delete-me.txt",
    "delete me\n",
    "text/plain",
  );
  await putTextObject(
    client,
    bucketName,
    "delete/delete-me-too.txt",
    "delete me too\n",
    "text/plain",
  );

  await putTextObject(client, bucketName, "versions/report.json", '{"version":1}\n', "application/json");
  await putTextObject(client, bucketName, "versions/report.json", '{"version":2}\n', "application/json");
  await putTextObject(client, bucketName, "versions/report.json", '{"version":3}\n', "application/json");
}
