/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useRef, useState } from "react";
import {
  streamPortalDeletedPrefixRestore,
  type PortalDeletedPrefixRestoreProgress,
  type PortalDeletedPrefixRestoreResult,
} from "../../api/portal";
import PageBanner from "../../components/PageBanner";
import WorkflowPage, { WorkflowActions } from "../../components/WorkflowPage";
import UiButton from "../../components/ui/UiButton";
import UiProgressBar from "../../components/ui/UiProgressBar";
import {
  cx,
  uiMutedTextClass,
  uiPanelMutedClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatCompactNumber } from "../../utils/format";
import type { BrowserObjectDetailsRouteTarget } from "../browser/browserPageContract";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import PortalWorkflowMetricCard from "./PortalWorkflowMetricCard";

type PortalDeletedPrefixRestoreWorkflowProps = {
  accountId: string | number;
  spaceId: string;
  spaceName: string;
  target: BrowserObjectDetailsRouteTarget;
  onClose: () => void;
  onBrowserRefresh: () => void;
  onWorkspaceRefresh: () => void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function PortalDeletedPrefixRestoreWorkflow({
  accountId,
  spaceId,
  spaceName,
  target,
  onClose,
  onBrowserRefresh,
  onWorkspaceRefresh,
}: PortalDeletedPrefixRestoreWorkflowProps) {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] =
    useState<PortalDeletedPrefixRestoreProgress | null>(null);
  const [result, setResult] =
    useState<PortalDeletedPrefixRestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const startRestore = async () => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);
    try {
      const restoreResult = await streamPortalDeletedPrefixRestore(
        accountId,
        spaceId,
        target.key,
        {
          signal: controller.signal,
          onProgress: setProgress,
        },
      );
      setResult(restoreResult);
      onBrowserRefresh();
      onWorkspaceRefresh();
    } catch (restoreError) {
      if (isAbortError(restoreError) || controller.signal.aborted) {
        setError(
          t({
            en: "Restoration stopped. Files already restored remain available.",
            fr: "Restauration arrêtée. Les fichiers déjà restaurés restent disponibles.",
            de: "Wiederherstellung gestoppt. Bereits wiederhergestellte Dateien bleiben verfügbar.",
          }),
        );
        onBrowserRefresh();
      } else {
        console.error(restoreError);
        setError(
          extractApiError(
            restoreError,
            t({
              en: "Unable to restore the deleted files in this folder.",
              fr: "Impossible de restaurer les fichiers supprimés de ce dossier.",
              de: "Gelöschte Dateien in diesem Ordner konnten nicht wiederhergestellt werden.",
            }),
          ),
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRunning(false);
    }
  };

  const close = () => {
    if (!running) onClose();
  };
  const processed =
    (progress?.restored_objects ?? 0) + (progress?.failed_objects ?? 0);
  const progressPercent =
    progress?.total_candidates_final && progress.restore_candidates > 0
      ? Math.min(
          100,
          Math.round((processed / progress.restore_candidates) * 100),
        )
      : progress?.stage === "completed"
        ? 100
        : null;

  return (
    <WorkflowPage
      title={t({
        en: "Restore deleted files",
        fr: "Restaurer les fichiers supprimés",
        de: "Gelöschte Dateien wiederherstellen",
      })}
      description={t({
        en: "Restore recoverable files from this folder and its subfolders.",
        fr: "Restaurez les fichiers récupérables de ce dossier et de ses sous-dossiers.",
        de: "Stellen Sie wiederherstellbare Dateien aus diesem Ordner und seinen Unterordnern wieder her.",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Spaces", fr: "Espaces", de: "Bereiche" }),
          to: "/portal/storage-spaces",
        },
        { label: spaceName },
        {
          label: t({
            en: "Restore folder",
            fr: "Restaurer le dossier",
            de: "Ordner wiederherstellen",
          }),
        },
      )}
      backLabel={t({
        en: "Back to files",
        fr: "Retour aux fichiers",
        de: "Zurück zu Dateien",
      })}
      onBack={running ? undefined : close}
      width="standard"
    >
      <div className="space-y-4">
        {error ? <PageBanner tone="warning">{error}</PageBanner> : null}
        <PageBanner tone="info">
          {t({
            en: "Only files that are currently deleted are restored. Existing files and version history are kept.",
            fr: "Seuls les fichiers actuellement supprimés sont restaurés. Les fichiers existants et leur historique sont conservés.",
            de: "Nur aktuell gelöschte Dateien werden wiederhergestellt. Vorhandene Dateien und der Versionsverlauf bleiben erhalten.",
          })}
        </PageBanner>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Space", fr: "Espace", de: "Bereich" })}
            </dt>
            <dd className={cx("mt-1 font-bold", uiTitleTextClass)}>
              {spaceName}
            </dd>
          </div>
          <div>
            <dt className={cx("font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Folder", fr: "Dossier", de: "Ordner" })}
            </dt>
            <dd className={cx("mt-1 break-all font-mono", uiTitleTextClass)}>
              {target.key}
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
                {formatCompactNumber(processed)} /{" "}
                {progress.total_candidates_final
                  ? formatCompactNumber(progress.restore_candidates)
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
                  en: "Deleted file restoration progress",
                  fr: "Progression de la restauration",
                  de: "Fortschritt der Wiederherstellung",
                })}
              >
                <div className="h-full w-full animate-pulse rounded-full bg-primary/70" />
              </div>
            ) : (
              <UiProgressBar
                value={progressPercent}
                label={t({
                  en: "Deleted file restoration progress",
                  fr: "Progression de la restauration",
                  de: "Fortschritt der Wiederherstellung",
                })}
                className="mt-2 h-2 bg-[var(--ui-surface-muted)]"
              />
            )}
            <p className={cx("mt-2 ui-caption", uiMutedTextClass)}>
              {t({
                en: `${formatCompactNumber(progress.scanned_versions)} versions and ${formatCompactNumber(progress.scanned_delete_markers)} deletion records scanned.`,
                fr: `${formatCompactNumber(progress.scanned_versions)} versions et ${formatCompactNumber(progress.scanned_delete_markers)} traces de suppression analysées.`,
                de: `${formatCompactNumber(progress.scanned_versions)} Versionen und ${formatCompactNumber(progress.scanned_delete_markers)} Löschvermerke geprüft.`,
              })}
            </p>
          </div>
        ) : null}

        {result ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <PortalWorkflowMetricCard
                label={t({ en: "Found", fr: "Trouvés", de: "Gefunden" })}
                value={formatCompactNumber(result.restore_candidates)}
                detail={t({
                  en: "recoverable files",
                  fr: "fichiers récupérables",
                  de: "wiederherstellbare Dateien",
                })}
              />
              <PortalWorkflowMetricCard
                label={t({
                  en: "Restored",
                  fr: "Restaurés",
                  de: "Wiederhergestellt",
                })}
                value={formatCompactNumber(result.restored_objects)}
                detail={t({
                  en: "returned to their folders",
                  fr: "replacés dans leurs dossiers",
                  de: "in ihre Ordner zurückgelegt",
                })}
              />
              <PortalWorkflowMetricCard
                label={t({
                  en: "Not restored",
                  fr: "Non restaurés",
                  de: "Nicht wiederhergestellt",
                })}
                value={formatCompactNumber(result.failed_objects)}
                detail={t({
                  en: "review below",
                  fr: "à vérifier ci-dessous",
                  de: "unten prüfen",
                })}
              />
            </div>
            {result.failures.length > 0 ? (
              <div className={uiPanelMutedClass}>
                <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
                  {t({
                    en: "Files requiring attention",
                    fr: "Fichiers à vérifier",
                    de: "Zu prüfende Dateien",
                  })}
                </p>
                <ul className="mt-2 space-y-1 ui-caption">
                  {result.failures.map((failure) => (
                    <li key={failure.key} className="break-all">
                      <span className="font-mono">{failure.key}</span>
                      {" — "}
                      {failure.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        <WorkflowActions>
          {running ? (
            <UiButton variant="secondary" onClick={() => abortRef.current?.abort()}>
              {t({ en: "Stop", fr: "Arrêter", de: "Stoppen" })}
            </UiButton>
          ) : result ? (
            <UiButton onClick={close}>
              {t({ en: "Done", fr: "Terminer", de: "Fertig" })}
            </UiButton>
          ) : (
            <>
              <UiButton variant="secondary" onClick={close}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton onClick={() => void startRestore()}>
                {t({
                  en: "Restore files",
                  fr: "Restaurer les fichiers",
                  de: "Dateien wiederherstellen",
                })}
              </UiButton>
            </>
          )}
        </WorkflowActions>
      </div>
    </WorkflowPage>
  );
}
