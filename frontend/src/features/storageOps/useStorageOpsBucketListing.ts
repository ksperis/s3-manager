import { useBucketOpsListing } from "../shared/useBucketOpsListing";
import { listStorageOpsBuckets, streamStorageOpsBuckets } from "../../api/storageOps";

type BucketSort = {
  field: string;
  direction: "asc" | "desc";
};

type UseStorageOpsBucketListingParams = {
  selectedEndpointId: number | null | undefined;
  page: number;
  pageSize: number;
  filterValue: string;
  advancedFilterParam?: string;
  advancedSearchEnabled: boolean;
  sort: BucketSort;
  includeParams: string[];
  requiresStats: boolean;
  baseRequiresStats: boolean;
  extractError: (err: unknown) => string;
};

export function useStorageOpsBucketListing({
  selectedEndpointId,
  page,
  pageSize,
  filterValue,
  advancedFilterParam,
  advancedSearchEnabled,
  sort,
  includeParams,
  requiresStats,
  baseRequiresStats,
  extractError,
}: UseStorageOpsBucketListingParams) {
  return useBucketOpsListing({
    selectedScopeId: selectedEndpointId,
    page,
    pageSize,
    filterValue,
    advancedFilterParam,
    advancedSearchEnabled,
    sort,
    includeParams,
    requiresStats,
    baseRequiresStats,
    extractError,
    listBuckets: listStorageOpsBuckets,
    streamBuckets: streamStorageOpsBuckets,
  });
}
