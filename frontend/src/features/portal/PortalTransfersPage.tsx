/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useMemo, useState } from "react";
import DataTableShell, { type DataTableColumn } from "../../components/list/DataTableShell";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UiProgressBar from "../../components/ui/UiProgressBar";
import { cx, uiDividerClass, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../utils/format";
import {
  portalTransferStatusTone,
  resolvePortalWorkspacePageState,
} from "./portalUi";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { portalTransferDirectionLabel, portalTransferStatusLabel } from "./portalI18n";
import type { PortalWorkspaceTransfer } from "./portalWorkspaceModel";
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
  const transfersTableStatus = transfers.length === 0 ? "empty" : "ready";
  const visibleSizeBytes = useMemo(
    () => transfers.reduce((sum, transfer) => sum + (transfer.sizeBytes ?? 0), 0),
    [transfers]
  );
  const transferColumns = useMemo<DataTableColumn<PortalWorkspaceTransfer>[]>(
    () => [
      {
        id: "name",
        label: t({ en: "Name", fr: "Nom", de: "Name" }),
        primary: true,
        cellClassName: "break-words",
        render: (transfer) => transfer.name,
      },
      {
        id: "type",
        label: t({ en: "Type", fr: "Type", de: "Typ" }),
        render: (transfer) => portalTransferDirectionLabel(transfer.direction, t),
      },
      {
        id: "status",
        label: t({ en: "Status", fr: "Statut", de: "Status" }),
        render: (transfer) => (
          <UiBadge tone={portalTransferStatusTone(transfer.status)}>{portalTransferStatusLabel(transfer.status, t)}</UiBadge>
        ),
      },
      {
        id: "progress",
        label: t({ en: "Progress", fr: "Progression", de: "Fortschritt" }),
        render: (transfer) => (
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-28 max-w-full"><UiProgressBar value={transfer.progress} /></div>
            <span className="shrink-0">{transfer.progress}%</span>
          </div>
        ),
      },
      {
        id: "speed",
        label: t({ en: "Speed", fr: "Débit", de: "Geschwindigkeit" }),
        render: (transfer) => transfer.speedLabel,
      },
      {
        id: "started",
        label: t({ en: "Started", fr: "Démarré", de: "Gestartet" }),
        render: (transfer) => transfer.startedLabel,
      },
      {
        id: "eta",
        label: t({ en: "ETA", fr: "ETA", de: "ETA" }),
        render: (transfer) => transfer.etaLabel,
      },
      {
        id: "details",
        label: t({ en: "Details", fr: "Détails", de: "Details" }),
        cellClassName: "break-words text-xs",
        render: (transfer) =>
          transfer.errorMessage ??
          (transfer.status === "Failed"
            ? t({ en: "Failure details unavailable.", fr: "Détails de l'échec indisponibles.", de: "Fehlerdetails nicht verfügbar." })
            : "-"),
      },
    ],
    [t]
  );

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
        <DataTableShell
          columns={transferColumns}
          rows={transfers}
          rowKey={(transfer) => transfer.id}
          status={transfersTableStatus}
          loadingMessage={t({ en: "Loading transfers...", fr: "Chargement des transferts...", de: "Übertragungen werden geladen..." })}
          errorMessage={t({ en: "Unable to load transfers.", fr: "Impossible de charger les transferts.", de: "Übertragungen können nicht geladen werden." })}
          emptyMessage={t({ en: "No transfers to display.", fr: "Aucun transfert à afficher.", de: "Keine Übertragungen zum Anzeigen." })}
          responsiveCards
        />
        <div className={cx("mt-3 text-[11px]", uiMutedTextClass)}>
          {t({ en: `Total visible size: ${formatBytes(visibleSizeBytes)}`, fr: `Taille visible totale : ${formatBytes(visibleSizeBytes)}`, de: `Gesamte sichtbare Größe: ${formatBytes(visibleSizeBytes)}` })}
        </div>
      </UiCard>
    </div>
  );
}
