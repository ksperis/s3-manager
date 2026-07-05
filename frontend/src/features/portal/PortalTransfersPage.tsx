/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiDividerClass, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import {
  portalTransferStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalTransferDirectionLabel, portalTransferStatusLabel } from "./portalI18n";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

type TransferTab = "all" | "uploads" | "downloads";

export default function PortalTransfersPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TransferTab>("all");
  const { workspace, loading, error, hasAccountContext, accountError, accountLoading } = usePortalWorkspaceData();
  const transfers = useMemo(() => {
    if (activeTab === "uploads") return workspace.transfers.filter((transfer) => transfer.direction === "Upload");
    if (activeTab === "downloads") return workspace.transfers.filter((transfer) => transfer.direction === "Download");
    return workspace.transfers;
  }, [activeTab, workspace.transfers]);

  const pageState = resolvePortalWorkspacePageState({
    accountLoading,
    loading,
    accountError,
    error,
    hasAccountContext,
    loadingMessage: t({ en: "Loading transfers...", fr: "Chargement des transferts...", de: "Transfers werden geladen..." }),
    noAccountMessage: t({ en: "Select a project to view transfers.", fr: "Sélectionnez un projet pour voir les transferts.", de: "Wählen Sie ein Projekt aus, um Transfers anzuzeigen." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Transfers", fr: "Transferts", de: "Transfers" })}
        description={t({ en: "Monitor ongoing and completed transfers.", fr: "Suivez les transferts en cours et terminés.", de: "Überwachen Sie laufende und abgeschlossene Transfers." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Transfers", fr: "Transferts", de: "Transfers" }) })}
      />
      <UiCard>
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={[
              { id: "all", label: t({ en: "All", fr: "Tous", de: "Alle" }) },
              { id: "uploads", label: t({ en: "Uploads", fr: "Envois", de: "Uploads" }) },
              { id: "downloads", label: t({ en: "Downloads", fr: "Téléchargements", de: "Downloads" }) },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as TransferTab)}
            variant="bar"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="ui-data-table min-w-[850px]">
            <thead>
              <tr>
                <th>{t({ en: "Name", fr: "Nom", de: "Name" })}</th>
                <th>{t({ en: "Type", fr: "Type", de: "Typ" })}</th>
                <th>{t({ en: "Status", fr: "Statut", de: "Status" })}</th>
                <th>{t({ en: "Progress", fr: "Progression", de: "Fortschritt" })}</th>
                <th>{t({ en: "Speed", fr: "Débit", de: "Geschwindigkeit" })}</th>
                <th>{t({ en: "Started", fr: "Démarré", de: "Gestartet" })}</th>
                <th>{t({ en: "ETA", fr: "ETA", de: "ETA" })}</th>
                <th>{t({ en: "Details", fr: "Détails", de: "Details" })}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.id}>
                  <td className={cx("font-bold", uiTitleTextClass)}>{transfer.name}</td>
                  <td>{portalTransferDirectionLabel(transfer.direction, t)}</td>
                  <td><UiBadge tone={portalTransferStatusTone(transfer.status)}>{portalTransferStatusLabel(transfer.status, t)}</UiBadge></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-28"><UiProgressBar value={transfer.progress} /></div>
                      <span>{transfer.progress}%</span>
                    </div>
                  </td>
                  <td>{transfer.speedLabel}</td>
                  <td>{transfer.startedLabel}</td>
                  <td>{transfer.etaLabel}</td>
                  <td className={cx("max-w-[240px] truncate text-xs", uiMutedTextClass)}>
                    {transfer.errorMessage ?? (transfer.status === "Failed" ? t({ en: "Failure details unavailable.", fr: "Détails de l'échec indisponibles.", de: "Fehlerdetails nicht verfügbar." }) : "-")}
                  </td>
                </tr>
              ))}
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                    {t({ en: "No transfers to display.", fr: "Aucun transfert à afficher.", de: "Keine Transfers zum Anzeigen." })}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className={cx("mt-3 text-[11px]", uiMutedTextClass)}>
          {t({ en: `Total visible size: ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}`, fr: `Taille visible totale : ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}`, de: `Gesamte sichtbare Größe: ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}` })}
        </div>
      </UiCard>
    </div>
  );
}
