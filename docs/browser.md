# S3 browser (/browser)

The `/browser` page talks only to standard S3 APIs; no RGW admin APIs are used. The backend signs requests and returns presigned URLs so uploads/downloads flow directly between the browser and S3.

## Backend surface

- `GET /api/manager/browser/buckets` — `ListBuckets`
- `GET /api/manager/browser/buckets/{bucket}/objects` — `ListObjectsV2` with delimiter/prefix/pagination
- `GET /api/manager/browser/buckets/{bucket}/cors` — `GetBucketCors` status for UI checks
- `GET /api/manager/browser/buckets/{bucket}/versions` — `ListObjectVersions`
- `GET /api/manager/browser/buckets/{bucket}/object-meta` — `HeadObject`
- `GET/PUT /api/manager/browser/buckets/{bucket}/object-tags` — `GetObjectTagging` / `PutObjectTagging` / `DeleteObjectTagging`
- `POST /api/manager/browser/buckets/{bucket}/presign` — presigned GET/PUT/DELETE/POST policies for direct browser calls
- `GET /api/manager/browser/sts` — STS availability check (GetCallerIdentity)
- `POST /api/manager/browser/buckets/{bucket}/copy` — `CopyObject` (used for move/metadata updates)
- `POST /api/manager/browser/buckets/{bucket}/delete` — `DeleteObjects` (version aware)
- `POST /api/manager/browser/buckets/{bucket}/folders` — `PutObject` (empty marker)
- `POST /api/manager/browser/buckets/{bucket}/proxy-upload` — backend proxy upload (form-data)
- `GET /api/manager/browser/buckets/{bucket}/proxy-download` — backend proxy download (stream)
- Multipart helpers: `CreateMultipartUpload`, `UploadPart` (presigned), `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListMultipartUploads`, `ListParts`

## Minimum IAM permissions

Bucket-level:
- `s3:ListBucket`, `s3:ListBucketVersions`, `s3:ListBucketMultipartUploads`

Object-level:
- `s3:GetObject`, `s3:GetObjectVersion`, `s3:GetObjectTagging`, `s3:GetObjectVersionTagging`
- `s3:PutObject`, `s3:PutObjectTagging`, `s3:PutObjectVersionTagging`, `s3:PutObjectAcl` (if ACL edits are enabled later)
- `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:DeleteObjectTagging`
- `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`, `s3:ListBucketMultipartUploads`, `s3:CreateMultipartUpload`, `s3:CompleteMultipartUpload`
- `s3:ListAllMyBuckets` (for the bucket switcher)
