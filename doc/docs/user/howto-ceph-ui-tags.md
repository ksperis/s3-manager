# How-to: Use UI tags in Ceph Admin

## When to use

Use **UI tags** in **Ceph Admin > Buckets** to organize working sets for investigations, cleanups, migrations, or operations campaigns.

## Prerequisites

- Access to `/ceph-admin/buckets`.
- An endpoint selected in Ceph Admin.

## Before you start

Use UI tags for operational grouping, not as S3 tags. UI tags are persisted by
BucketReef. Bucket assignments remain isolated by Ceph endpoint, while visible
definitions can be reused on another endpoint. A **Private** definition belongs
to you; a **Shared** definition and its assignments are visible and manageable
by Ceph Admins.

## Steps

1. Open **Ceph Admin > Buckets**.
2. Select one or more buckets in the table.
3. Open **Actions… > Selection > Manage UI tags…**, then choose **Add tags**:
   - Pick an existing suggestion, or
   - Add a custom tag with the `new-tag` input. **Private** is selected by
     default; choose **Shared** only when the whole Ceph Admin team should use it.
4. In the same dialog, choose **Remove tags** to remove tags from the current selection.
5. Reuse UI tags to filter and manage recurring operational groups.

## Expected result

Selected buckets receive persistent UI tags that can be reused from another
browser or session. A private and a shared definition may have the same label;
the visibility indicator identifies which one is being used.

## You are done when

The selected rows show the intended UI tags and the tag filter can recover the same working set.

## If you do not see this action

Check that rows are selected and that you are on the Ceph Admin bucket workbench.

## Limits / feature flags

!!! note
    UI tags are BucketReef control-plane metadata. They never call or modify the
    S3 Tags API. Legacy `bucket-workbench.ui_tags.v2` browser data is not
    imported or read and remains untouched in local storage. View preferences
    stay local, but UI-tag filters now store definition identifiers.

    At workbench load, a dedicated backend check compares persisted UI-tag
    assignments with the endpoint bucket inventory. This check is independent
    from the lightweight tag-definition catalogue and does not transfer every
    bucket assignment to the browser. If a bucket is missing, the warning
    banner can remove its UI tags; the backend rechecks that the bucket has not
    reappeared before removing them.

## Related pages

- [Workspace: Ceph Admin](workspace-ceph-admin.md)
- [How-to: Use Advanced Filter in Ceph Admin](howto-ceph-advanced-filter.md)

## Visual example

<div class="docs-themed-shot" data-docs-themed-shot>
  <img class="docs-themed-shot__image docs-themed-shot__image--light" data-docs-shot-variant="light" src="../../assets/screenshots/user/ceph-admin-ui-tags.light.png" alt="Ceph Admin UI tags workflow on selected buckets" loading="lazy">
  <img class="docs-themed-shot__image docs-themed-shot__image--dark" data-docs-shot-variant="dark" src="../../assets/screenshots/user/ceph-admin-ui-tags.dark.png" alt="Ceph Admin UI tags workflow on selected buckets" loading="lazy">
</div>
