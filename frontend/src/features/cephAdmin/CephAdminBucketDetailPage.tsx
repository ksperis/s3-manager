/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import BucketDetailPage from "../manager/BucketDetailPage";
import { useLocation } from "react-router-dom";
import { useBucketListBackNavigation } from "../shared/bucketListReturnContext";

export default function CephAdminBucketDetailPage() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const endpointId = params.get("ep");
  const fallbackListUrl = endpointId
    ? `/ceph-admin/buckets?${new URLSearchParams({ ep: endpointId }).toString()}`
    : "/ceph-admin/buckets";
  const { listUrl, onBack } = useBucketListBackNavigation("ceph-admin", fallbackListUrl);

  return (
    <BucketDetailPage
      mode="ceph-admin"
      bucketListPathOverride={listUrl}
      onBackToBuckets={onBack}
    />
  );
}
