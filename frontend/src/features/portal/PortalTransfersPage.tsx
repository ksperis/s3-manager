/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import ManagerTable, {
  managerTableCellClass,
  managerTablePrimaryCellClass,
  managerTableWideCellClass,
} from "../../components/list/ManagerTable";
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
    loadingMessage: t({ en: "Loading transfers...", fr: "Chargement des transferts...", de: "Übertragungen werden geladen..." }),
    noAccountMessage: t({ en: "Select an account to view transfers.", fr: "Sélectionnez un compte pour voir les transferts.", de: "Wählen Sie ein Konto aus, um Übertragungen anzuzeigen." }),
  });
  if (pageState) return pageState;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t({ en: "Transfers", fr: "Transferts", de: "Übertragungen" })}
        description={t({ en: "Monitor ongoing and completed transfers.", fr: "Suivez les transferts en cours et terminés.", de: "Überwachen Sie laufende und abgeschlossene Übertragungen." })}
        breadcrumbs={portalBreadcrumbs({ label: t({ en: "Transfers", fr: "Transferts", de: "Übertragungen" }) })}
      />
      <UiCard>
        <div className={cx("mb-3 border-b pb-3", uiDividerClass)}>
          <PageTabs
            tabs={[
              { id: "all", label: t({ en: "All", fr: "Tous", de: "Alle" }) },
              { id: "uploads", label: t({ en: "Uploads", fr: "Envois", de: "Hochladen" }) },
              { id: "downloads", label: t({ en: "Downloads", fr: "Téléchargements", de: "Herunterladen" }) },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as TransferTab)}
            variant="bar"
          />
        </div>
        <ManagerTable
          responsiveCards
          columns={[
            { key: "name", label: t({ en: "Name", fr: "Nom", de: "Name" }), mobileRole: "primary" },
            { key: "type", label: t({ en: "Type", fr: "Type", de: "Typ" }) },
            { key: "status", label: t({ en: "Status", fr: "Statut", de: "Status" }) },
            { key: "progress", label: t({ en: "Progress", fr: "Progression", de: "Fortschritt" }) },
            { key: "speed", label: t({ en: "Speed", fr: "Débit", de: "Geschwindigkeit" }) },
            { key: "started", label: t({ en: "Started", fr: "Démarré", de: "Gestartet" }) },
            { key: "eta", label: t({ en: "ETA", fr: "ETA", de: "ETA" }) },
            { key: "details", label: t({ en: "Details", fr: "Détails", de: "Details" }) },
          ]}
        >
          {transfers.map((transfer) => (
            <tr key={transfer.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className={cx(managerTablePrimaryCellClass, "break-words", uiTitleTextClass)}>{transfer.name}</td>
              <td className={managerTableCellClass}>{portalTransferDirectionLabel(transfer.direction, t)}</td>
              <td className={managerTableCellClass}>
                <UiBadge tone={portalTransferStatusTone(transfer.status)}>{portalTransferStatusLabel(transfer.status, t)}</UiBadge>
              </td>
              <td className={managerTableCellClass}>
                <div className="flex min-w-0 items-center gap-2">
                  <div className="w-28 max-w-full"><UiProgressBar value={transfer.progress} /></div>
                  <span className="shrink-0">{transfer.progress}%</span>
                </div>
              </td>
              <td className={managerTableCellClass}>{transfer.speedLabel}</td>
              <td className={managerTableCellClass}>{transfer.startedLabel}</td>
              <td className={managerTableCellClass}>{transfer.etaLabel}</td>
              <td className={cx(managerTableWideCellClass, "break-words text-xs", uiMutedTextClass)}>
                {transfer.errorMessage ?? (transfer.status === "Failed" ? t({ en: "Failure details unavailable.", fr: "Détails de l'échec indisponibles.", de: "Fehlerdetails nicht verfügbar." }) : "-")}
              </td>
            </tr>
          ))}
          {transfers.length === 0 ? (
            <tr>
              <td colSpan={8} className={cx("py-6 text-center text-xs font-semibold", uiMutedTextClass)}>
                {t({ en: "No transfers to display.", fr: "Aucun transfert à afficher.", de: "Keine Übertragungen zum Anzeigen." })}
              </td>
            </tr>
          ) : null}
        </ManagerTable>
        <div className={cx("mt-3 text-[11px]", uiMutedTextClass)}>
          {t({ en: `Total visible size: ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}`, fr: `Taille visible totale : ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}`, de: `Gesamte sichtbare Größe: ${formatBytes(transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0))}` })}
        </div>
      </UiCard>
    </div>
  );
}
