/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useState } from "react";
import PageBanner from "../../components/PageBanner";
import PageHeader from "../../components/PageHeader";
import TableEmptyState from "../../components/TableEmptyState";
import PaginationControls from "../../components/PaginationControls";
import { CephAdminRgwAccount, listCephAdminAccounts } from "../../api/cephAdmin";
import { useCephAdminEndpoint } from "./CephAdminEndpointContext";

const extractError = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    return ((err.response?.data as { detail?: string } | undefined)?.detail || err.message || "Unexpected error");
  }
  return err instanceof Error ? err.message : "Unexpected error";
};

export default function CephAdminAccountsPage() {
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [items, setItems] = useState<CephAdminRgwAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!selectedEndpointId) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    listCephAdminAccounts(selectedEndpointId, {
      page,
      page_size: pageSize,
      search: searchValue || undefined,
    })
      .then((data) => {
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((err) => {
        setError(extractError(err));
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedEndpointId, page, pageSize, searchValue]);

  useEffect(() => {
    setPage(1);
  }, [selectedEndpointId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchValue(filter.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filter]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="RGW Accounts"
        description="Liste complète des accounts (admin ops)."
        breadcrumbs={[{ label: "Ceph Admin", to: "/ceph-admin" }, { label: "Accounts" }]}
      />

      {!selectedEndpointId && <PageBanner tone="warning">Select a Ceph endpoint first.</PageBanner>}
      {selectedEndpoint && (
        <PageBanner tone="info">
          Endpoint: <span className="font-semibold">{selectedEndpoint.name}</span>
        </PageBanner>
      )}
      {error && <PageBanner tone="error">{error}</PageBanner>}
      {loading && <PageBanner tone="info">Loading accounts…</PageBanner>}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Accounts</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">{total} result(s)</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filter</span>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by id or name"
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-64"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="manager-table min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Account ID
                </th>
                <th className="px-4 py-3 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Name
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.length === 0 && <TableEmptyState colSpan={2} message="No accounts found." />}
              {items.map((acc) => (
                <tr key={acc.account_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-6 py-4 ui-body font-semibold text-slate-900 dark:text-slate-100">{acc.account_id}</td>
                  <td className="px-6 py-4 ui-body text-slate-600 dark:text-slate-300">{acc.account_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          disabled={loading || !selectedEndpointId}
        />
      </div>
    </div>
  );
}
