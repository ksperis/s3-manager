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
} from "recharts";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import StatCards from "../../components/StatCards";
import { useI18n } from "../../i18n";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { extractApiError } from "../../utils/apiError";
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
  const { t } = useI18n();
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
      } catch (err) {
        if (!cancelled) {
          setDetail(null);
          setError(
            extractApiError(
              err,
              t({
                en: "Unable to load billing data.",
                fr: "Impossible de charger les donnees de facturation.",
                de: "Abrechnungsdaten konnen nicht geladen werden.",
              })
            )
          );
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
  }, [month, accountIdForApi, hasAccountContext, t]);

  const stats = useMemo(() => {
    return [
      {
        label: t({ en: "Avg storage", fr: "Stockage moyen", de: "Durchschn. Speicher" }),
        value: formatBytes(detail?.storage.avg_bytes ?? null),
        hint: t({ en: "Average daily storage", fr: "Moyenne quotidienne de stockage", de: "Taglicher Durchschnittsspeicher" }),
      },
      {
        label: t({ en: "Egress", fr: "Egress", de: "Ausgehend" }),
        value: formatBytes(detail?.usage.bytes_out ?? null),
        hint: t({ en: "Outgoing bytes", fr: "Octets sortants", de: "Ausgehende Bytes" }),
      },
      {
        label: t({ en: "Ingress", fr: "Ingress", de: "Eingehend" }),
        value: formatBytes(detail?.usage.bytes_in ?? null),
        hint: t({ en: "Incoming bytes", fr: "Octets entrants", de: "Eingehende Bytes" }),
      },
      {
        label: t({ en: "Requests", fr: "Requetes", de: "Anfragen" }),
        value: formatCompactNumber(detail?.usage.ops_total ?? null),
        hint: t({ en: "Total API calls", fr: "Total des appels API", de: "Gesamte API-Aufrufe" }),
      },
      {
        label: t({ en: "Estimated cost", fr: "Cout estime", de: "Geschaftzte Kosten" }),
        value: detail?.cost?.total_cost != null ? formatCurrency(detail.cost.total_cost, detail.cost.currency) : "-",
        hint: detail?.cost?.rate_card_name
          ? `${t({ en: "Rate card", fr: "Grille tarifaire", de: "Tarifkarte" })}: ${detail.cost.rate_card_name}`
          : t({ en: "No rate card", fr: "Aucune grille tarifaire", de: "Keine Tarifkarte" }),
      },
    ];
  }, [detail, t]);

  const dailySeries = useMemo(() => {
    return (detail?.daily ?? []).map((point) => ({
      ...point,
      label: point.day.slice(5),
      traffic_bytes: (point.bytes_in ?? 0) + (point.bytes_out ?? 0),
    }));
  }, [detail]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Billing", fr: "Facturation", de: "Abrechnung" })}
        description={t({ en: "Monthly usage and cost overview.", fr: "Vue mensuelle de l'utilisation et des couts.", de: "Monatliche Ubersicht uber Nutzung und Kosten." })}
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col text-sm text-slate-600 dark:text-slate-300">
          {t({ en: "Month", fr: "Mois", de: "Monat" })}
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
      </div>
      {accountLoading && <PageBanner tone="info">{t({ en: "Loading account context...", fr: "Chargement du contexte de compte...", de: "Kontokontext wird geladen..." })}</PageBanner>}
      {accountError && <PageBanner tone="warning">{accountError}</PageBanner>}
      {!accountLoading && !accountError && !hasAccountContext && (
        <PageBanner tone="warning">{t({ en: "Select an account to view billing data.", fr: "Selectionnez un compte pour voir la facturation.", de: "Wahlen Sie ein Konto, um Abrechnungsdaten anzuzeigen." })}</PageBanner>
      )}
      {loading && <PageBanner tone="info">{t({ en: "Loading billing data...", fr: "Chargement des donnees de facturation...", de: "Abrechnungsdaten werden geladen..." })}</PageBanner>}
      {error && <PageBanner tone="warning">{error}</PageBanner>}
      {!loading && !error && <StatCards stats={stats} columns={3} />}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Storage (daily)", fr: "Stockage (quotidien)", de: "Speicher (taglich)" })}</h4>
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
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => formatBytes(Number(value) || 0)}
                    domain={["dataMin", "dataMax"]}
                  />
                  <Tooltip formatter={(value) => formatBytes(value as number)} />
                  <Area type="monotone" dataKey="storage_bytes" stroke="#3b82f6" fill="url(#portalStorageFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Traffic (daily)", fr: "Trafic (quotidien)", de: "Verkehr (taglich)" })}</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value) || 0)} />
                  <Tooltip formatter={(value) => formatBytes(value as number)} />
                  <Bar dataKey="traffic_bytes" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t({ en: "Requests (daily)", fr: "Requetes (quotidien)", de: "Anfragen (taglich)" })}</h4>
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value) || 0)} />
                  <Tooltip formatter={(value) => formatCompactNumber(value as number)} />
                  <Bar dataKey="ops_total" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
