/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import PageBanner from "../../components/PageBanner";
import { getTagColors } from "./bucketOpsPresentation";

export type OrphanedTagBucketDetail = {
  key: string;
  endpointId: number;
  name: string;
  tenant: string | null;
  tags: string[];
};

type BucketOpsOrphanedTagsBannerProps = {
  details: readonly OrphanedTagBucketDetail[];
  onClear: () => void;
};

export default function BucketOpsOrphanedTagsBanner({
  details,
  onClear,
}: BucketOpsOrphanedTagsBannerProps) {
  if (details.length === 0) return null;

  const plural = details.length > 1;
  return (
    <PageBanner tone="warning">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            UI tags exist for {details.length} bucket{plural ? "s" : ""} no
            longer present on {plural ? "their recorded endpoints" : "its recorded endpoint"}.
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 ui-caption font-semibold text-amber-800 hover:border-amber-400 dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
          >
            Remove tags
          </button>
        </div>
        <details className="rounded-md border border-amber-300/70 bg-amber-50/70 px-2 py-1.5 dark:border-amber-700/50 dark:bg-amber-950/20">
          <summary className="list-none cursor-pointer ui-caption font-semibold text-amber-900 dark:text-amber-100 [&::-webkit-details-marker]:hidden">
            Show affected bucket/tag details
          </summary>
          <div className="mt-2 max-h-40 space-y-2 overflow-auto pr-1">
            {details.map((item) => (
              <div
                key={item.key}
                className="rounded-md border border-amber-200/80 bg-white/80 px-2 py-1.5 dark:border-amber-700/40 dark:bg-slate-900/50"
              >
                <p className="ui-caption font-semibold text-amber-900 dark:text-amber-100">
                  {item.name}
                  {item.tenant ? (
                    <span className="ml-1 font-normal text-amber-800/90 dark:text-amber-200/90">
                      (tenant: {item.tenant})
                    </span>
                  ) : null}
                  <span className="ml-1 font-normal text-amber-800/90 dark:text-amber-200/90">
                    (endpoint: {item.endpointId})
                  </span>
                </p>
                {item.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.tags.map((tag) => {
                      const colors = getTagColors(tag);
                      return (
                        <span
                          key={`${item.key}:${tag}`}
                          className="rounded-full border px-2 py-0.5 ui-caption font-semibold"
                          style={{
                            backgroundColor: colors.background,
                            color: colors.text,
                            borderColor: colors.border,
                          }}
                        >
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 ui-caption text-amber-800/90 dark:text-amber-200/90">
                    No tag values found.
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      </div>
    </PageBanner>
  );
}
