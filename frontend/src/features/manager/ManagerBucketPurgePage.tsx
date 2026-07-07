/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";

import { type Bucket, listBuckets } from "../../api/buckets";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import ManagerTable, { managerTableCheckboxCellClass, managerTablePrimaryCellClass } from "../../components/list/ManagerTable";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import BucketPurgeRunModal from "../shared/BucketPurgeRunModal";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerBucketPurgePage() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [showPurgeModal, setShowPurgeModal] = useState(false);

  const sourceContext = useMemo(
    () => accounts.find((context) => context.id === sourceContextId) ?? null,
    [accounts, sourceContextId]
  );

  useEffect(() => {
    if (!sourceContextId) {
      setBuckets([]);
      setSelectedBuckets(new Set());
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        setBuckets(sorted);
        setSelectedBuckets((current) => {
          const availableNames = new Set(sorted.map((bucket) => bucket.name));
          return new Set([...current].filter((bucketName) => availableNames.has(bucketName)));
        });
      })
      .catch((err) => {
        if (canceled) return;
        setError(extractApiError(err, "Unable to load buckets."));
        setBuckets([]);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const filteredBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return buckets;
    return buckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [buckets, filter]);

  const selectedBucketList = useMemo(() => {
    return [...selectedBuckets].sort((a, b) => a.localeCompare(b));
  }, [selectedBuckets]);

  const selectedTargets = useMemo(
    () =>
      selectedBucketList.map((bucketName) => ({
        bucketName,
        contextId: sourceContextId,
        contextName: sourceContext?.display_name ?? sourceContextId,
      })),
    [selectedBucketList, sourceContext?.display_name, sourceContextId]
  );

  const toggleBucket = (bucketName: string) => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      if (next.has(bucketName)) {
        next.delete(bucketName);
      } else {
        next.add(bucketName);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedBuckets((current) => {
      const next = new Set(current);
      filteredBuckets.forEach((bucket) => next.add(bucket.name));
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedBuckets(new Set());
  };

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: filteredBuckets.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bucket purge"
        description="Empty selected buckets without deleting bucket configuration."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Purge" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket purge is unavailable in session mode"
          description="This tool needs a persistent execution context so the selected buckets can be purged with the same manager identity."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a context before purging buckets"
          description="Choose a manager execution context to load its buckets and launch a purge."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Buckets"
            description={`${sourceContext ? sourceContext.display_name : "Source context"} - Select buckets to purge.`}
            showHeading={false}
            countLabel={`${filteredBuckets.length} result(s)`}
            search={
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter buckets"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 ui-caption text-slate-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 sm:w-80 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            }
            filters={
              <>
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  disabled={filteredBuckets.length === 0}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
                >
                  Select filtered
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selectedBuckets.size === 0}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-500"
                >
                  Clear
                </button>
              </>
            }
            actions={
              <button
                type="button"
                onClick={() => setShowPurgeModal(true)}
                disabled={selectedBuckets.size === 0 || loading}
                className="rounded-md bg-rose-600 px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Purge selected ({selectedBuckets.size})
              </button>
            }
          />
          <ManagerTable
            responsiveCards
            columns={[
              { key: "select", label: "Select", className: "w-12", hideLabel: true, mobileLabel: "Select" },
              { key: "bucket", label: "Bucket", mobileRole: "primary" },
            ]}
          >
            {tableStatus === "loading" && <TableEmptyState colSpan={2} message="Loading buckets..." />}
            {tableStatus === "error" && <TableEmptyState colSpan={2} message="Unable to load buckets." tone="error" />}
            {tableStatus === "empty" && <TableEmptyState colSpan={2} message="No buckets." />}
            {filteredBuckets.map((bucket) => (
              <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className={managerTableCheckboxCellClass}>
                  <input
                    aria-label={`Select ${bucket.name}`}
                    type="checkbox"
                    checked={selectedBuckets.has(bucket.name)}
                    onChange={() => toggleBucket(bucket.name)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 dark:border-slate-600"
                  />
                </td>
                <td className={managerTablePrimaryCellClass}>{bucket.name}</td>
              </tr>
            ))}
          </ManagerTable>
        </div>
      )}

      {showPurgeModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketPurgeRunModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowPurgeModal(false)}
        />
      )}
    </div>
  );
}
