# Screenshots by workspace

This page groups representative UI captures by workspace.

Each carousel uses synthetic documentation data and focuses on the screens that matter most to day-to-day operators.

## Admin

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
</div>

## Manager

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

## Browser

<div class="docs-screenshot-carousel" data-docs-carousel data-carousel-title="Browser workspace">
  <figure data-thumb-label="Overview">
    <img src="../../assets/screenshots/user/workspace-browser.png" alt="Browser workspace with bucket panel, object list, and operations toolbar" loading="lazy">
    <figcaption><strong>Overview.</strong> Browser keeps buckets, prefixes, and object actions in one place for direct day-to-day storage work.</figcaption>
  </figure>
  <figure data-thumb-label="Operations">
    <img src="../../assets/screenshots/user/feature-objects-browser.png" alt="Browser object operations page with upload controls and details panel" loading="lazy">
    <figcaption><strong>Object operations.</strong> Upload, download, preview, restore, metadata, and bulk actions stay available from the same browsing surface.</figcaption>
  </figure>
  <figure data-thumb-label="User flow">
    <img src="../../assets/screenshots/user/use-cases-storage-user.png" alt="Browser workspace showing a storage user workflow with object tools" loading="lazy">
    <figcaption><strong>Daily user flow.</strong> This example shows the Browser surface in a realistic object-management workflow for storage users.</figcaption>
  </figure>
</div>

## Ceph Admin

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

## Storage Ops

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
