/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useState } from "react";

import { type Bucket, listBuckets } from "../../api/buckets";
import { listExecutionContexts, type ExecutionContext } from "../../api/executionContexts";
import ListToolbar from "../../components/ListToolbar";
import PageBanner from "../../components/PageBanner";
import PageEmptyState from "../../components/PageEmptyState";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";
import { useS3AccountContext } from "./S3AccountContext";

function extractError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (error.response?.data as { detail?: string } | undefined)?.detail || error.message || "Request failed";
  }
  return error instanceof Error ? error.message : "Request failed";
}

export default function ManagerBucketComparePage() {
  const { selectedS3AccountId, requiresS3AccountSelection } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";
  const [contexts, setContexts] = useState<ExecutionContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(true);
  const [contextsError, setContextsError] = useState<string | null>(null);
  const [sourceBuckets, setSourceBuckets] = useState<Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);
  const [bucketsError, setBucketsError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set());
  const [showCompareModal, setShowCompareModal] = useState(false);

  const sourceContext = useMemo(
    () => contexts.find((context) => context.id === sourceContextId) ?? null,
    [contexts, sourceContextId]
  );

  useEffect(() => {
    let canceled = false;
    setContextsLoading(true);
    setContextsError(null);
    listExecutionContexts("manager")
      .then((items) => {
        if (canceled) return;
        setContexts(items);
      })
      .catch((error) => {
        if (canceled) return;
        setContextsError(extractError(error));
      })
      .finally(() => {
        if (!canceled) setContextsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!sourceContextId) {
      setSourceBuckets([]);
      setSelectedBuckets(new Set());
      return;
    }
    let canceled = false;
    setBucketsLoading(true);
    setBucketsError(null);
    listBuckets(sourceContextId, { with_stats: false })
      .then((items) => {
        if (canceled) return;
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        setSourceBuckets(sorted);
        setSelectedBuckets((current) => {
          const next = new Set<string>();
          current.forEach((bucketName) => {
            if (sorted.some((bucket) => bucket.name === bucketName)) {
              next.add(bucketName);
            }
          });
          return next;
        });
      })
      .catch((error) => {
        if (canceled) return;
        setBucketsError(extractError(error));
        setSourceBuckets([]);
      })
      .finally(() => {
        if (!canceled) setBucketsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [sourceContextId]);

  const filteredBuckets = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sourceBuckets;
    return sourceBuckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
  }, [filter, sourceBuckets]);

  const selectedBucketList = useMemo(() => {
    return [...selectedBuckets].sort((a, b) => a.localeCompare(b));
  }, [selectedBuckets]);

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

  const openCompareModal = () => {
    if (selectedBuckets.size === 0) return;
    setShowCompareModal(true);
  };

  const tableStatus = resolveListTableStatus({
    loading: bucketsLoading,
    error: bucketsError,
    rowCount: filteredBuckets.length,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bucket compare"
        description="Compare selected buckets across manager contexts."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Compare" }]}
      />

      {contextsError && <PageBanner tone="error">{contextsError}</PageBanner>}
      {bucketsError && <PageBanner tone="error">{bucketsError}</PageBanner>}

      {!requiresS3AccountSelection ? (
        <PageEmptyState
          title="Bucket compare is unavailable in session mode"
          description="This tool needs a persistent execution context so it can load a source inventory and compare it against other manager contexts."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : !sourceContextId ? (
        <PageEmptyState
          title="Select a source context before comparing buckets"
          description="Choose a manager execution context to load its buckets, filter the source inventory, and compare selected buckets against other targets."
          primaryAction={{ label: "Open buckets", to: "/manager/buckets" }}
          tone="warning"
        />
      ) : (
        <div className="ui-surface-card">
          <ListToolbar
            title="Buckets"
            description={`${sourceContext ? sourceContext.display_name : "Source context"} · Select source buckets to compare across manager contexts.`}
            countLabel={`${filteredBuckets.length} result(s)`}
            search={
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter source buckets"
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
                onClick={openCompareModal}
                disabled={selectedBuckets.size === 0 || bucketsLoading || contextsLoading}
                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Compare selected ({selectedBuckets.size})
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
                {tableStatus === "loading" && <TableEmptyState colSpan={2} message="Loading source buckets..." />}
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

      {showCompareModal && sourceContextId && selectedBucketList.length > 0 && (
        <ManagerBucketCompareModal
          sourceContextId={sourceContextId}
          sourceContextName={sourceContext?.display_name ?? sourceContextId}
          sourceBuckets={selectedBucketList}
          contexts={contexts}
          onClose={() => setShowCompareModal(false)}
        />
      )}
    </div>
  );
}
