/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { PortalPublicLink } from "../../api/portalSharing";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import { useI18n } from "../../i18n";

type PortalPublicLinkRevokeDialogProps = {
  link: PortalPublicLink;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function PortalPublicLinkRevokeDialog({
  link,
  loading,
  onCancel,
  onConfirm,
}: PortalPublicLinkRevokeDialogProps) {
  const { t } = useI18n();
  return (
    <ConfirmActionDialog
      title={t({
        en: "Revoke public link",
        fr: "Révoquer le lien public",
        de: "Öffentlichen Link widerrufen",
      })}
      description={t({
        en: "Confirm that you want to revoke this public link.",
        fr: "Confirmez que vous voulez révoquer ce lien public.",
        de: "Bestätigen Sie, dass Sie diesen öffentlichen Link widerrufen möchten.",
      })}
      confirmLabel={t({
        en: "Revoke link",
        fr: "Révoquer le lien",
        de: "Link widerrufen",
      })}
      loading={loading}
      details={[
        {
          label: t({ en: "File", fr: "Fichier", de: "Datei" }),
          value: link.object_name,
        },
        {
          label: t({ en: "Space", fr: "Espace", de: "Bereich" }),
          value: link.storage_space_name,
        },
        {
          label: t({ en: "Link", fr: "Lien", de: "Link" }),
          value: link.url,
          mono: true,
        },
      ]}
      impacts={[
        t({
          en: "Anyone using this URL loses access immediately.",
          fr: "Toute personne utilisant cette URL perd immédiatement l'accès.",
          de: "Alle, die diese URL verwenden, verlieren sofort den Zugriff.",
        }),
        t({
          en: "The file remains in the space.",
          fr: "Le fichier reste dans l'espace.",
          de: "Die Datei bleibt im Bereich.",
        }),
      ]}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
