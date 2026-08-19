# Glossary and Search Tips

Use this page when a term in the UI or documentation is unclear.

## Core terms

| Term | Meaning |
|---|---|
| Workspace | A top-level UI surface such as Admin, Manager, Portal, Browser, Ceph Admin, or Storage Ops. |
| Storage endpoint | A configured S3-compatible backend target. Ceph RGW, AWS-like, Scality, MinIO, and other providers can expose endpoints with different capabilities. |
| S3 account | A platform-level account entity used mainly for Ceph RGW administration, IAM, quotas, usage, metrics, and account workflows. |
| S3 connection | A credential-first connection to an S3-compatible endpoint. It is used for day-to-day bucket and object work across supported backends. |
| Execution context | The selected identity and scope used to execute an action. It can be an account, connection, S3 user, or authorized Ceph Admin endpoint context. |
| Storage Space | The Portal name for an assigned storage area. It can map to a bucket internally, but Portal keeps the user-facing language simple. |
| Portal role | Owner for a private space, Viewer or Editor for a team space, and Manager for project-wide administration. These roles translate into storage-side permissions. |
| Manager access | Per-user or inherited access to advanced Manager tools and managed private-connection provisioning. |
| Feature flag | A setting that enables or disables a workspace or feature globally or for a surface. |
| Endpoint capability | A backend capability reported or configured for an endpoint, such as IAM, SNS, metrics, usage, SSE, replication, or static website support. |
| UI tags | Local console metadata used to organize working sets. UI tags are not backend S3 object or bucket tags unless a feature explicitly updates S3 tags. |
| AccessDenied | A storage-side denial from IAM or S3. It is expected when credentials do not allow the requested action. |
| Application audit | Control-plane, security, configuration, and workflow-control events stored by BucketReef. It excludes object data operations. |
| S3 access logs | Provider-side data-plane evidence for object requests. Delivery may be delayed and depends on activation and retention. |

## Search tips

| If you search for... | Also try |
|---|---|
| files, folders | Browser, object operations, Portal files, Storage Spaces |
| permissions, denied, forbidden | AccessDenied, IAM, feature availability, execution context |
| access key, secret key, credentials | Portal Access Keys, IAM, S3 connection |
| activity, history, audit | Portal Activity, Admin audit, usage history |
| transfer, upload progress, queue | Browser operation bar, Portal traffic metrics, bucket migration |
| quota, capacity, usage | Admin Usage and Metrics, usage stats, quota monitoring, Portal usage, billing |
| sharing, collaborator, public link | Portal sharing, Viewer, Editor, Manager |
| delete, empty bucket, purge | Bucket purge, safe destructive operations, object delete |
| migrate, sync, copy bucket | Bucket migration, Bucket compare |
| endpoint down, latency, incident | Endpoint Status, healthchecks, observability |

## You are done when

You can match the UI term to the correct workspace and know which page to open next.

## Related pages

- [Start here](start-here.md)
- [Feature availability](feature-availability.md)
- [Workspace: Manager](workspace-manager.md)
- [Workspace: Portal](workspace-portal.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/start-here.light.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/start-here.dark.png" alt="Workspace switcher open to choose where to continue" loading="lazy">
</div>
