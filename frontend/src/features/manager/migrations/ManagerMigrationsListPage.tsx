/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../../components/PageHeader";
import { type BucketMigrationStatus } from "../../../api/managerMigrations";
import { useS3AccountContext } from "../S3AccountContext";
import { useManagerContexts, useManagerMigrationsList } from "./hooks";
import {
  computeProgress,
  formatDateTime,
  statusChipClasses,
} from "./shared";

const SORT_PRIORITY: Record<BucketMigrationStatus, number> = {
  running: 0,
  queued: 1,
  pause_requested: 2,
  cancel_requested: 3,
  paused: 4,
  awaiting_cutover: 5,
  draft: 6,
  failed: 7,
  completed_with_errors: 8,
  canceled: 9,
  completed: 10,
  rolled_back: 11,
};

export default function ManagerMigrationsListPage() {
  const navigate = useNavigate();
  const { selectedS3AccountId } = useS3AccountContext();
  const sourceContextId = selectedS3AccountId ?? "";

  const { contextLabelById, contextsLoading, contextsError } = useManagerContexts();
  const { migrations, migrationsLoading, migrationsError } = useManagerMigrationsList(sourceContextId);

  const sortedMigrations = useMemo(
    () =>
      [...migrations].sort((left, right) => {
      const priorityLeft = SORT_PRIORITY[left.status] ?? 99;
      const priorityRight = SORT_PRIORITY[right.status] ?? 99;
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return right.id - left.id;
    }),
    [migrations]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bucket Migration"
        description="Track migrations and open an operational view for each run."
        breadcrumbs={[{ label: "Manager" }, { label: "Tools" }, { label: "Migration" }]}
        actions={[
          {
            label: "New migration",
            onClick: () => navigate("/manager/migrations/new"),
          },
        ]}
      />

      {contextsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading contexts...</p>}
      {contextsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{contextsError}</p>}
      {migrationsError && <p className="ui-caption text-rose-600 dark:text-rose-300">{migrationsError}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="max-h-[720px] space-y-2 overflow-auto">
          {migrationsLoading && <p className="ui-caption text-slate-500 dark:text-slate-400">Loading migrations...</p>}
          {!migrationsLoading && sortedMigrations.length === 0 && (
            <p className="ui-caption text-slate-500 dark:text-slate-400">No migrations yet.</p>
          )}

          {sortedMigrations.map((migration) => {
            const done = migration.completed_items + migration.failed_items + migration.skipped_items;
            const percent = computeProgress(done, migration.total_items);
            return (
              <button
                key={migration.id}
                type="button"
                onClick={() => navigate(`/manager/migrations/${migration.id}`)}
                className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="ui-caption font-semibold text-slate-800 dark:text-slate-100">Migration #{migration.id}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClasses(migration.status)}`}>
                    {migration.status}
                  </span>
                </div>

                <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                  {contextLabelById.get(migration.source_context_id) ?? migration.source_context_id} {"->"}{" "}
                  {contextLabelById.get(migration.target_context_id) ?? migration.target_context_id}
                </p>

                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    {done}/{migration.total_items} done ({percent}%)
                  </p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">updated: {formatDateTime(migration.updated_at)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
