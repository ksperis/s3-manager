/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  portalStorageSpaceVersionCleanupConfirmationPhrase,
  streamPortalStorageSpaceVersionCleanup,
  type PortalStorageSpaceVersionCleanupProgress,
  type PortalStorageSpaceVersionCleanupResult,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import WorkflowPage, { WorkflowActions } from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiProgressBar from "../../components/ui/UiProgressBar";
import {
  cx,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes, formatCompactNumber } from "../../utils/format";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalWorkflowMetricCard from "./PortalWorkflowMetricCard";

type PortalStorageSpaceHistoryCleanupWorkflowProps = {
  accountId: string | number;
  spaceId: string;
  spaceName: string;
  usedBytes?: number | null;
  enabled: boolean;
  onClose: () => void;
  onStart: () => void;
  onCompleted: (bytesFreed: number) => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function PortalStorageSpaceHistoryCleanupWorkflow({
  accountId,
  spaceId,
  spaceName,
  usedBytes,
  enabled,
  onClose,
  onStart,
  onCompleted,
}: PortalStorageSpaceHistoryCleanupWorkflowProps) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] =
    useState<PortalStorageSpaceVersionCleanupProgress | null>(null);
  const [result, setResult] =
    useState<PortalStorageSpaceVersionCleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const runCleanup = useCallback(async () => {
    if (!enabled || runningRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);
    onStart();
    try {
      const cleanupResult = await streamPortalStorageSpaceVersionCleanup(
        accountId,
        spaceId,
        {
          confirmation:
            portalStorageSpaceVersionCleanupConfirmationPhrase(spaceName),
        },
        {
          signal: controller.signal,
          onProgress: setProgress,
        },
      );
      setResult(cleanupResult);
      onCompleted(cleanupResult.bytes_freed);
    } catch (cleanupError) {
      if (isAbortError(cleanupError)) {
        setError(
          t({
            en: "Cleanup canceled.",
            fr: "Nettoyage annulé.",
            de: "Bereinigung abgebrochen.",
          }),
        );
      } else {
        setError(
          extractApiError(
            cleanupError,
            t({
              en: "Unable to clean up this Storage Space history.",
              fr: "Impossible de nettoyer l'historique de cet espace.",
              de: "Der Verlauf dieses Bereichs kann nicht bereinigt werden.",
            }),
          ),
        );
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [accountId, enabled, onCompleted, onStart, spaceId, spaceName, t]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runCleanup();
  }, [runCleanup]);

  const deletedEntries =
    (progress?.deleted_versions ?? 0) +
    (progress?.deleted_delete_markers ?? 0);
  const progressPercent = progress
    ? progress.delete_candidates > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((deletedEntries / progress.delete_candidates) * 100),
          ),
        )
      : progress.stage === "completed"
        ? 100
        : null
    : null;

  return (
    <WorkflowPage
      title={t({
        en: "Clean up history",
        fr: "Nettoyer l'historique",
        de: "Historie bereinigen",
      })}
      description={t({
        en: "Review the impact, follow the complete scan and keep the cleanup result visible.",
        fr: "Vérifiez l'impact, suivez l'analyse complète et conservez le résultat du nettoyage visible.",
        de: "Prüfen Sie die Auswirkungen, verfolgen Sie den vollständigen Scan und behalten Sie das Ergebnis sichtbar.",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
          to: "/portal/storage-spaces",
        },
        { label: spaceName },
        {
          label: t({
            en: "History cleanup",
            fr: "Nettoyage de l'historique",
            de: "Historienbereinigung",
          }),
        },
      )}
      backLabel={t({
        en: "Back to the space",
        fr: "Retour à l'espace",
        de: "Zurück zum Bereich",
      })}
      onBack={running ? undefined : onClose}
      width="standard"
    >
      <div className="space-y-4">
        {error ? <PageBanner tone="warning">{error}</PageBanner> : null}
        <PageBanner tone="warning">
          {t({
            en: "This scans the entire space, deletes older file versions, then removes leftover deletion records. Current files are kept, but deleted history cannot be restored from Portal.",
            fr: "Cette opération parcourt tout l'espace, supprime les anciennes versions de fichiers, puis retire les traces de suppression restantes. Les fichiers courants sont conservés, mais l'historique supprimé ne pourra pas être restauré depuis Portal.",
            de: "Diese Aktion durchsucht den gesamten Bereich, löscht ältere Dateiversionen und entfernt verbliebene Löschvermerke. Aktuelle Dateien bleiben erhalten, gelöschte Historie kann in Portal aber nicht wiederhergestellt werden.",
          })}
        </PageBanner>

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Space", fr: "Espace", de: "Bereich" })}
            </dt>
            <dd className={cx("mt-1 break-all font-bold", uiTitleTextClass)}>
              {spaceName}
            </dd>
          </div>
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({
                en: "Current storage",
                fr: "Stockage courant",
                de: "Aktueller Speicher",
              })}
            </dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
              {formatBytes(usedBytes)}
            </dd>
          </div>
        </dl>

        {progress ? (
          <div className="rounded-md border border-[color:var(--ui-border)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                {progress.message ?? progress.stage}
              </p>
              <p className={cx("ui-caption", uiMutedTextClass)}>
                {formatCompactNumber(deletedEntries)} /{" "}
                {progress.total_candidates_final
                  ? formatCompactNumber(progress.delete_candidates)
                  : progress.delete_candidates > 0
                    ? t({
                        en: `at least ${formatCompactNumber(progress.delete_candidates)}`,
                        fr: `au moins ${formatCompactNumber(progress.delete_candidates)}`,
                        de: `mindestens ${formatCompactNumber(progress.delete_candidates)}`,
                      })
                    : t({
                        en: "discovering",
                        fr: "détection",
                        de: "wird ermittelt",
                      })}
              </p>
            </div>
            {progressPercent === null ? (
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-surface-muted)]"
                role="progressbar"
                aria-label={t({
                  en: "Storage Space history cleanup progress",
                  fr: "Progression du nettoyage de l'historique",
                  de: "Fortschritt der Historienbereinigung",
                })}
              >
                <div className="h-full w-full animate-pulse rounded-full bg-rose-500/70" />
              </div>
            ) : (
              <UiProgressBar
                value={progressPercent}
                label={t({
                  en: "Storage Space history cleanup progress",
                  fr: "Progression du nettoyage de l'historique",
                  de: "Fortschritt der Historienbereinigung",
                })}
                className="mt-2 h-2 bg-[var(--ui-surface-muted)]"
                barClassName="bg-rose-600 transition-[width] duration-150 ease-out"
              />
            )}
            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
              {t({
                en: `${formatCompactNumber(progress.scanned_versions)} versions scanned, ${formatCompactNumber(progress.scanned_delete_markers)} delete markers scanned, ${formatBytes(progress.bytes_freed)} gained so far.`,
                fr: `${formatCompactNumber(progress.scanned_versions)} versions scannées, ${formatCompactNumber(progress.scanned_delete_markers)} delete markers scannés, ${formatBytes(progress.bytes_freed)} gagnés pour l'instant.`,
                de: `${formatCompactNumber(progress.scanned_versions)} Versionen geprüft, ${formatCompactNumber(progress.scanned_delete_markers)} Delete Marker geprüft, bisher ${formatBytes(progress.bytes_freed)} frei geworden.`,
              })}
            </p>
          </div>
        ) : null}

        {result ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <PortalWorkflowMetricCard
              label={t({
                en: "Space gained",
                fr: "Espace gagné",
                de: "Frei geworden",
              })}
              value={formatBytes(result.bytes_freed)}
              detail={t({ en: "estimated", fr: "estimé", de: "geschätzt" })}
            />
            <PortalWorkflowMetricCard
              label={t({
                en: "Versions deleted",
                fr: "Versions supprimées",
                de: "Versionen gelöscht",
              })}
              value={formatCompactNumber(result.deleted_versions)}
              detail={t({
                en: "historical",
                fr: "historiques",
                de: "historisch",
              })}
            />
            <PortalWorkflowMetricCard
              label={t({
                en: "Markers removed",
                fr: "Markers retirés",
                de: "Marker entfernt",
              })}
              value={formatCompactNumber(result.deleted_delete_markers)}
              detail={t({
                en: "orphan delete markers",
                fr: "delete markers orphelins",
                de: "verwaiste Delete Marker",
              })}
            />
          </div>
        ) : null}

        <WorkflowActions>
          <UiButton
            variant="secondary"
            onClick={onClose}
            disabled={running}
          >
            {result
              ? t({ en: "Done", fr: "Terminer", de: "Fertig" })
              : t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          </UiButton>
          {running ? (
            <UiButton variant="danger" onClick={() => abortRef.current?.abort()}>
              {t({
                en: "Stop cleanup",
                fr: "Arrêter le nettoyage",
                de: "Bereinigung stoppen",
              })}
            </UiButton>
          ) : (
            <UiButton
              variant="danger"
              onClick={() => void runCleanup()}
              disabled={Boolean(result) || !enabled}
            >
              {t({
                en: "Start cleanup",
                fr: "Démarrer le nettoyage",
                de: "Bereinigung starten",
              })}
            </UiButton>
          )}
        </WorkflowActions>
      </div>
    </WorkflowPage>
  );
}
