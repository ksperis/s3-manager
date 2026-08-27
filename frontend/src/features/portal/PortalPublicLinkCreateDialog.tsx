/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalPublicLink } from "../../api/portal";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import UiButton from "../../components/ui/UiButton";
import UiInput from "../../components/ui/UiInput";
import { cx, uiMutedTextClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";

type PortalPublicLinkCreateDialogProps = {
  fileName: string;
  path: string;
  spaceName: string;
  expiration: string;
  busy: boolean;
  canCreate: boolean;
  error?: string | null;
  message?: string | null;
  createdLink?: PortalPublicLink | null;
  onExpirationChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onCopy?: () => void;
};

export default function PortalPublicLinkCreateDialog({
  fileName,
  path,
  spaceName,
  expiration,
  busy,
  canCreate,
  error,
  message,
  createdLink,
  onExpirationChange,
  onClose,
  onCreate,
  onCopy,
}: PortalPublicLinkCreateDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      title={t({
        en: "Create public link",
        fr: "Créer un lien public",
        de: "Öffentlichen Link erstellen",
      })}
      onClose={onClose}
      closeOnBackdropClick={!busy}
      closeOnEscape={!busy}
    >
      <div className="space-y-4">
        {error ? <PageBanner tone="warning">{error}</PageBanner> : null}
        {message ? <PageBanner tone="info">{message}</PageBanner> : null}
        <dl className="grid gap-3 text-xs">
          {[
            [t({ en: "File", fr: "Fichier", de: "Datei" }), fileName, false],
            [t({ en: "Path", fr: "Chemin", de: "Pfad" }), path, true],
            [t({ en: "Space", fr: "Espace", de: "Bereich" }), spaceName, false],
          ].map(([label, value, mono]) => (
            <div key={label as string} className="grid grid-cols-[120px_1fr] gap-3">
              <dt className={cx("font-semibold", uiMutedTextClass)}>{label}</dt>
              <dd
                className={
                  mono
                    ? "min-w-0 break-all font-mono text-[11px]"
                    : cx("min-w-0 break-all font-bold", uiTitleTextClass)
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <UiInput
          type="datetime-local"
          label={t({ en: "Expiration", fr: "Expiration", de: "Ablauf" })}
          size="compact"
          className="h-9"
          value={expiration}
          disabled={busy || Boolean(createdLink)}
          onChange={(event) => onExpirationChange(event.target.value)}
          aria-label={t({
            en: "Public link expiration",
            fr: "Expiration du lien public",
            de: "Ablauf des öffentlichen Links",
          })}
        />
        {createdLink ? (
          <div className="rounded-md border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
            <div className={cx("text-[11px] font-semibold uppercase", uiMutedTextClass)}>
              {t({ en: "Public link", fr: "Lien public", de: "Öffentlicher Link" })}
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all rounded-md bg-[var(--ui-surface)] px-2 py-1 text-[11px]">
                {createdLink.url}
              </code>
              {onCopy ? (
                <UiButton size="sm" variant="secondary" onClick={onCopy}>
                  {t({ en: "Copy link", fr: "Copier le lien", de: "Link kopieren" })}
                </UiButton>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <UiButton variant="secondary" onClick={onClose} disabled={busy}>
            {createdLink
              ? t({ en: "Done", fr: "Terminer", de: "Fertig" })
              : t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          </UiButton>
          <UiButton
            onClick={onCreate}
            loading={busy}
            disabled={busy || Boolean(createdLink) || !canCreate}
          >
            {busy
              ? t({ en: "Creating...", fr: "Création...", de: "Wird erstellt..." })
              : t({ en: "Create link", fr: "Créer le lien", de: "Link erstellen" })}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
