/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import { tableCompactIconActionButtonClasses } from "../../components/tableActionClasses";
import UiActionMenu, { type UiActionMenuSection } from "../../components/ui/UiActionMenu";
import type { BucketAdminOpsKind } from "../cephAdmin/CephAdminAdminOpsModal";
import { bucketAction, BUCKET_ACTION_GROUP_LABELS } from "./bucketActionCatalog";

type BucketOpsRowActionsMenuProps = {
  bucket: CephAdminBucket;
  isStorageOps: boolean;
  selectedEndpointId: number | null | undefined;
  cephAdminBrowserEnabled: boolean;
  onOpenInBrowser: (bucket: CephAdminBucket) => void;
  onConfigure: (bucket: CephAdminBucket) => void;
  onAdminOps?: (bucket: CephAdminBucket, kind: BucketAdminOpsKind) => void;
  onOpenInManager?: (bucket: CephAdminBucket) => void;
};

export default function BucketOpsRowActionsMenu({
  bucket,
  isStorageOps,
  selectedEndpointId,
  cephAdminBrowserEnabled,
  onOpenInBrowser,
  onConfigure,
  onAdminOps,
  onOpenInManager,
}: BucketOpsRowActionsMenuProps) {
  const sections: UiActionMenuSection[] = isStorageOps
    ? [
        {
          id: "navigation",
          label: BUCKET_ACTION_GROUP_LABELS.navigation,
          items: [
            {
              ...bucketAction("open-manager"),
              disabled: !onOpenInManager,
              disabledReason: "Manager action unavailable for this bucket context.",
              onSelect: () => onOpenInManager?.(bucket),
            },
          ],
        },
        {
          id: "s3",
          label: BUCKET_ACTION_GROUP_LABELS.s3,
          items: [{ ...bucketAction("configure-one"), onSelect: () => onConfigure(bucket) }],
        },
      ]
    : [
        {
          id: "navigation",
          label: BUCKET_ACTION_GROUP_LABELS.navigation,
          items: [
            {
              ...bucketAction("open-browser"),
              disabled: !selectedEndpointId || !cephAdminBrowserEnabled,
              disabledReason: "Ceph Admin Browser is disabled in application settings.",
              onSelect: () => onOpenInBrowser(bucket),
            },
          ],
        },
        {
          id: "s3",
          label: BUCKET_ACTION_GROUP_LABELS.s3,
          items: [{ ...bucketAction("configure-one"), onSelect: () => onConfigure(bucket) }],
        },
        {
          id: "rgw",
          label: BUCKET_ACTION_GROUP_LABELS.rgw,
          items: [
            { ...bucketAction("check-index-one"), onSelect: () => onAdminOps?.(bucket, "index-check") },
            { ...bucketAction("link-bucket"), onSelect: () => onAdminOps?.(bucket, "link-bucket") },
          ],
        },
        {
          id: "destructive-rgw",
          label: BUCKET_ACTION_GROUP_LABELS["destructive-rgw"],
          items: [
            { ...bucketAction("unlink-bucket"), onSelect: () => onAdminOps?.(bucket, "unlink-bucket") },
            { ...bucketAction("delete-bucket"), onSelect: () => onAdminOps?.(bucket, "delete-bucket") },
          ],
        },
      ];

  return (
    <UiActionMenu
      ariaLabel={`Actions for bucket ${bucket.name}`}
      trigger={<span aria-hidden="true">⋮</span>}
      triggerClassName={tableCompactIconActionButtonClasses}
      sections={sections}
      minWidth={240}
      menuClassName="w-60"
    />
  );
}
