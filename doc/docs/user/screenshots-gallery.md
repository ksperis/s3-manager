# Screenshots by workspace

This page groups representative UI captures by workspace.

Each carousel uses synthetic documentation data and focuses on the screens that matter most to day-to-day operators.

## Admin { #admin }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Admin workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/workspace-admin.png" alt="Admin workspace overview with platform navigation and summary cards" loading="lazy">
    <figcaption><strong>Overview.</strong> The Admin workspace groups platform navigation, governance entry points, and high-level health signals for daily operators.</figcaption>
  </figure>
  <figure data-thumb-label="UI Users">
    <img src="../../assets/screenshots/user/admin-ui-users.png" alt="Admin UI Users page with roles, last login, and workspace associations" loading="lazy">
    <figcaption><strong>UI Users.</strong> This page centralizes workspace roles, Ceph Admin and Storage Ops access, and the main account associations for each user.</figcaption>
  </figure>
  <figure data-thumb-label="Endpoints">
    <img src="../../assets/screenshots/user/admin-storage-endpoints.png" alt="Admin Storage endpoints page showing endpoint capabilities and credentials state" loading="lazy">
    <figcaption><strong>Storage endpoints.</strong> Endpoint cards surface provider capabilities, credential posture, and feature toggles before tenant resources are attached to them.</figcaption>
  </figure>
  <figure data-thumb-label="Endpoint Status">
    <img src="../../assets/screenshots/user/admin-endpoint-status.png" alt="Admin Endpoint Status page with latency overview, health timelines, and recent incidents" loading="lazy">
    <figcaption><strong>Endpoint Status.</strong> Global healthcheck views combine current latency, timeline trends, and incident history across storage backends.</figcaption>
  </figure>
  <figure data-thumb-label="Billing">
    <img src="../../assets/screenshots/user/admin-billing.png" alt="Admin Billing page with monthly summary, subject totals, and selected account detail charts" loading="lazy">
    <figcaption><strong>Billing.</strong> Billing analytics summarize monthly usage and estimated cost per account or user on billing-enabled Ceph endpoints.</figcaption>
  </figure>
</div>

## Manager { #manager }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Manager workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/workspace-manager.png" alt="Manager workspace dashboard with buckets, topics, and migration tools" loading="lazy">
    <figcaption><strong>Overview.</strong> The Manager dashboard helps tenant administrators jump between buckets, IAM, events, and migration tooling from the selected context.</figcaption>
  </figure>
  <figure data-thumb-label="Buckets">
    <img src="../../assets/screenshots/user/feature-buckets.png" alt="Manager bucket list with creation and configuration controls" loading="lazy">
    <figcaption><strong>Buckets.</strong> Bucket listing highlights ownership, usage, and key capabilities such as versioning, lifecycle, and access controls.</figcaption>
  </figure>
  <figure data-thumb-label="IAM">
    <img src="../../assets/screenshots/user/feature-iam.png" alt="Manager IAM users page with principal inventory" loading="lazy">
    <figcaption><strong>IAM.</strong> The IAM area exposes native user, group, role, and policy management without hiding storage-side semantics.</figcaption>
  </figure>
  <figure data-thumb-label="Compare">
    <img src="../../assets/screenshots/user/feature-bucket-compare.png" alt="Manager bucket compare result with differences and remediation actions" loading="lazy">
    <figcaption><strong>Bucket compare.</strong> Comparison results show drift between source and target buckets before remediation or migration decisions are made.</figcaption>
  </figure>
  <figure data-thumb-label="Migration">
    <img src="../../assets/screenshots/user/feature-bucket-migration.png" alt="Manager bucket migration page with migration runs and statuses" loading="lazy">
    <figcaption><strong>Bucket migration.</strong> Migration runs expose prechecks, progress, and operator controls so cross-context transfers remain explicit and auditable.</figcaption>
  </figure>
</div>

## Browser { #browser }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Browser workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/workspace-browser.png" alt="Browser workspace with bucket panel, object list, and operations toolbar" loading="lazy">
    <figcaption><strong>Overview.</strong> Browser keeps buckets, prefixes, and object actions in one place for direct day-to-day storage work.</figcaption>
  </figure>
  <figure data-thumb-label="Panels">
    <img src="../../assets/screenshots/user/use-cases-storage-user.png" alt="Browser workspace with folders panel, action bar, and details inspector open on a daily report object" loading="lazy">
    <figcaption><strong>Panels.</strong> On the main `/browser` workspace, folders, selection actions, and inspector details can stay visible together for faster daily work.</figcaption>
  </figure>
  <figure data-thumb-label="Operations">
    <img src="../../assets/screenshots/user/feature-objects-browser.png" alt="Browser operations overview modal showing an in-progress delete across selected objects" loading="lazy">
    <figcaption><strong>Operations overview.</strong> Long-running Browser actions stay visible in one modal so users can track queued, active, and completed work.</figcaption>
  </figure>
  <figure data-thumb-label="Versions">
    <img src="../../assets/screenshots/user/feature-object-versions-browser.png" alt="Browser object versions modal listing prior versions and a delete marker for a report object" loading="lazy">
    <figcaption><strong>Object history.</strong> The versions modal exposes prior object states and delete markers before you restore or remove entries.</figcaption>
  </figure>
</div>

## Ceph Admin { #ceph-admin }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Ceph Admin workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/workspace-ceph-admin.png" alt="Ceph Admin workspace with endpoint selector and RGW inventory" loading="lazy">
    <figcaption><strong>Overview.</strong> Ceph Admin keeps cluster-wide RGW operations separate from tenant-scoped Manager work.</figcaption>
  </figure>
  <figure data-thumb-label="Filters">
    <img src="../../assets/screenshots/user/ceph-admin-advanced-filter.png" alt="Ceph Admin buckets page with advanced filter drawer open" loading="lazy">
    <figcaption><strong>Advanced filter.</strong> The advanced filter drawer helps operators narrow cluster-wide bucket inventories during investigations or cleanup work.</figcaption>
  </figure>
  <figure data-thumb-label="UI tags">
    <img src="../../assets/screenshots/user/ceph-admin-ui-tags.png" alt="Ceph Admin selected buckets with UI tag operations open" loading="lazy">
    <figcaption><strong>UI tags.</strong> UI tags let admins build temporary operational working sets without changing backend bucket metadata.</figcaption>
  </figure>
</div>

## Storage Ops { #storage-ops }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Storage Ops workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/storage-ops-dashboard.png" alt="Storage Ops dashboard with cross-context operations entry point" loading="lazy">
    <figcaption><strong>Overview.</strong> Storage Ops is a focused workspace for advanced bucket operations across the contexts a user is authorized to inspect.</figcaption>
  </figure>
  <figure data-thumb-label="Buckets">
    <img src="../../assets/screenshots/user/workspace-storage-ops.png" alt="Storage Ops buckets page with cross-context bucket inventory" loading="lazy">
    <figcaption><strong>Buckets.</strong> The bucket workbench brings together cross-account and cross-connection inventory, filtering, and bulk actions.</figcaption>
  </figure>
  <figure data-thumb-label="UI tags">
    <img src="../../assets/screenshots/user/storage-ops-ui-tags.png" alt="Storage Ops bucket list with UI tags workflow on selected buckets" loading="lazy">
    <figcaption><strong>UI tags.</strong> Tagging selected buckets helps operators isolate remediation or migration campaigns across large inventories.</figcaption>
  </figure>
</div>

## Portal { #portal }

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Portal workspace">
  <figure data-thumb-label="Historical">
    <img src="../../assets/screenshots/user/workspace-portal.png" alt="Historical Portal workspace screenshot with guided self-service flow" loading="lazy">
    <figcaption><strong>Historical view.</strong> Portal is currently removed from the active product surface, but this capture is kept as reference for the earlier guided self-service experience.</figcaption>
  </figure>
</div>
