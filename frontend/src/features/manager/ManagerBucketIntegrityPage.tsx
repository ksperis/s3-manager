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
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import { extractApiError } from "../../utils/apiError";
import BucketIntegrityCheckModal from "../shared/BucketIntegrityCheckModal";
import { useS3AccountContext } from "./S3AccountContext";

export default function ManagerBucketIntegrityPage() {
  const { accounts, selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);

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
        title="Bucket integrity"
        description="Read selected bucket objects and report retrieval failures."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Integrity" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket integrity is unavailable in session mode"
          description="This tool needs a persistent execution context so the selected buckets can be checked with the same manager identity."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a context before checking buckets"
          description="Choose a manager execution context to load its buckets and launch an integrity check."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Buckets"
            description={`${sourceContext ? sourceContext.display_name : "Source context"} - Select buckets to check.`}
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
                onClick={() => setShowIntegrityModal(true)}
                disabled={selectedBuckets.size === 0 || loading}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Check selected ({selectedBuckets.size})
              </button>
            }
          />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="w-12 px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Select
                  </th>
                  <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Bucket
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {tableStatus === "loading" && <TableEmptyState colSpan={2} message="Loading buckets..." />}
                {tableStatus === "error" && <TableEmptyState colSpan={2} message="Unable to load buckets." tone="error" />}
                {tableStatus === "empty" && <TableEmptyState colSpan={2} message="No buckets." />}
                {filteredBuckets.map((bucket) => (
                  <tr key={bucket.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedBuckets.has(bucket.name)}
                        onChange={() => toggleBucket(bucket.name)}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30 dark:border-slate-600"
                      />
                    </td>
                    <td className="px-4 py-2 ui-body font-semibold text-slate-800 dark:text-slate-100">{bucket.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showIntegrityModal && sourceContextId && selectedTargets.length > 0 && (
        <BucketIntegrityCheckModal
          mode="manager"
          contextId={sourceContextId}
          contextName={sourceContext?.display_name ?? sourceContextId}
          targets={selectedTargets}
          onClose={() => setShowIntegrityModal(false)}
        />
      )}
    </div>
  );
}
