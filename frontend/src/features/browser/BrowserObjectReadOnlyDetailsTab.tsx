/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ObjectMetadata, ObjectTag } from "../../api/browserContracts";
import PageBanner from "../../components/PageBanner";
import { formatBytes } from "../../utils/format";
import { browserPanelCardClasses, toolbarButtonClasses } from "./browserConstants";
import type { BrowserItem } from "./browserTypes";
import { formatDateTime } from "./browserUtils";
import DetailsList from "../shared/DetailsList";

type BrowserObjectReadOnlyDetailsTabProps = {
  bucketName: string;
  error: string | null;
  item: BrowserItem;
  loaded: boolean;
  loading: boolean;
  metadata: ObjectMetadata | null;
  onRefresh: () => Promise<unknown> | void;
  tags: ObjectTag[];
};

function PairList({ emptyLabel, items }: { emptyLabel: string; items: ObjectTag[] }) {
  if (items.length === 0) {
    return <p className="ui-caption text-[var(--ui-text-muted)]">{emptyLabel}</p>;
  }
  return (
    <dl className="grid gap-2 ui-caption">
      {items.map((item, index) => (
        <div key={`${item.key}-${index}`} className="grid min-w-0 gap-1 sm:grid-cols-2 sm:gap-3">
          <dt className="min-w-0 break-all font-semibold text-[var(--ui-text)]">{item.key}</dt>
          <dd className="min-w-0 break-all text-[var(--ui-text-muted)] sm:text-right">{item.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BrowserObjectFactsCard({
  bucketName,
  item,
  metadata,
}: Pick<BrowserObjectReadOnlyDetailsTabProps, "bucketName" | "item" | "metadata">) {
  const facts: Array<[string, string]> = [
    ["Bucket", bucketName],
    ["Size", formatBytes(metadata?.size ?? item.sizeBytes ?? null)],
    [
      "Last modified",
      metadata?.last_modified
        ? formatDateTime(metadata.last_modified)
        : item.modified,
    ],
    ["Owner", item.owner || "-"],
    ["Storage class", metadata?.storage_class ?? item.storageClass ?? "-"],
    ["ETag", metadata?.etag ?? item.etag ?? "-"],
    ["Version ID", metadata?.version_id ?? "-"],
  ];

  return (
    <section className={browserPanelCardClasses}>
      <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-400">Object facts</p>
      <DetailsList
        compact
        valueAlign="end"
        items={facts.map(([label, value]) => ({ label, value, title: value }))}
      />
    </section>
  );
}

export default function BrowserObjectReadOnlyDetailsTab({
  bucketName,
  error,
  item,
  loaded,
  loading,
  metadata,
  onRefresh,
  tags,
}: BrowserObjectReadOnlyDetailsTabProps) {
  const headers: Array<[string, string]> = [
    ["Content type", metadata?.content_type ?? "-"],
    ["Cache control", metadata?.cache_control ?? "-"],
    ["Content disposition", metadata?.content_disposition ?? "-"],
    ["Content encoding", metadata?.content_encoding ?? "-"],
    ["Content language", metadata?.content_language ?? "-"],
    ["Expires", metadata?.expires ? formatDateTime(metadata.expires) : "-"],
  ];
  const customMetadata = Object.entries(metadata?.metadata ?? {}).map(([key, value]) => ({ key, value }));

  return (
    <div className="space-y-4">
      {loading && !loaded ? <p className="ui-caption text-[var(--ui-text-muted)]">Loading object details...</p> : null}
      {error ? (
        <PageBanner
          tone="error"
          className="flex flex-wrap items-center justify-between gap-2 font-semibold"
        >
          <span>{error}</span>
          <button type="button" className={toolbarButtonClasses} onClick={() => void onRefresh()} disabled={loading}>Retry</button>
        </PageBanner>
      ) : null}
      <BrowserObjectFactsCard bucketName={bucketName} item={item} metadata={metadata} />
      <section className={browserPanelCardClasses}>
        <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-400">HTTP headers</p>
        <DetailsList
          compact
          valueAlign="end"
          items={headers.map(([label, value]) => ({ label, value, title: value }))}
        />
      </section>
      <section className={browserPanelCardClasses}>
        <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-400">Custom metadata</p>
        <PairList items={customMetadata} emptyLabel="No custom metadata defined." />
      </section>
      <section className={browserPanelCardClasses}>
        <p className="mb-3 ui-caption font-semibold uppercase tracking-wide text-slate-400">Tags</p>
        <PairList items={tags} emptyLabel="No tags defined." />
      </section>
    </div>
  );
}
