/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Line,
  LineChart,
} from "recharts";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import StatCards from "../../components/StatCards";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { BillingSubjectDetail, getPortalBillingMe } from "../../api/billing";
import { usePortalAccountContext } from "./PortalAccountContext";

function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function formatCurrency(value?: number | null, currency?: string | null): string {
  if (value === undefined || value === null) return "-";
  return `${value.toFixed(2)} ${currency || "EUR"}`;
}

export default function PortalBillingPage() {
  const { accountIdForApi, selectedAccount, hasAccountContext, loading: accountLoading, error: accountError } = usePortalAccountContext();
  const [month, setMonth] = useState<string>(currentMonth());
  const [detail, setDetail] = useState<BillingSubjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasAccountContext || !accountIdForApi) {
        setDetail(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getPortalBillingMe(month, accountIdForApi);
        if (!cancelled) {
          setDetail(data);
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
          setError("Unable to load billing data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [month, accountIdForApi, hasAccountContext]);

  const stats = useMemo(() => {
    return [
      {
        label: "Avg storage",
        value: formatBytes(detail?.storage.avg_bytes ?? null),
        hint: "Average daily storage",
      },
      {
        label: "Egress",
        value: formatBytes(detail?.usage.bytes_out ?? null),
        hint: "Outgoing bytes",
      },
      {
        label: "Requests",
        value: formatCompactNumber(detail?.usage.ops_total ?? null),
        hint: "Total API calls",
      },
      {
        label: "Estimated cost",
        value: detail?.cost?.total_cost != null ? formatCurrency(detail.cost.total_cost, detail.cost.currency) : "-",
        hint: detail?.cost?.rate_card_name ? `Rate card: ${detail.cost.rate_card_name}` : "No rate card",
      },
    ];
  }, [detail]);

  const dailySeries = useMemo(() => {
    return (detail?.daily ?? []).map((point) => ({
      ...point,
      label: point.day.slice(5),
    }));
  }, [detail]);

  return (
    <div className="space-y-4">
      <PageHeader title="Billing" description="Monthly usage and cost overview." />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col text-sm text-slate-600 dark:text-slate-300">
          Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      </div>
      {accountLoading && <PageBanner tone="info">Loading account context...</PageBanner>}
      {accountError && <PageBanner tone="warning">{accountError}</PageBanner>}
      {!accountLoading && !accountError && !hasAccountContext && (
        <PageBanner tone="warning">Select an account to view billing data.</PageBanner>
      )}
      {loading && <PageBanner tone="info">Loading billing data...</PageBanner>}
      {error && <PageBanner tone="warning">{error}</PageBanner>}
      {!loading && !error && <StatCards stats={stats} columns={2} />}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Storage (daily)</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySeries}>
                  <defs>
                    <linearGradient id="portalStorageFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatBytes(value as number)} />
                  <Area type="monotone" dataKey="storage_bytes" stroke="#3b82f6" fill="url(#portalStorageFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Egress (daily)</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatBytes(value as number)} />
                  <Bar dataKey="bytes_out" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">Requests (daily)</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatCompactNumber(value as number)} />
                  <Line type="monotone" dataKey="ops_total" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
