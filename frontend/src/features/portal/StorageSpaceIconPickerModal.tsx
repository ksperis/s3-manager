/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import type { S3AccountSelector } from "../../api/accountParams";
import {
  updatePortalStorageSpaceIcon,
  uploadPortalStorageSpaceIcon,
} from "../../api/portal";
import type {
  StorageSpaceIconPreset,
  StorageSpaceIconSource,
} from "../../api/storageSpaceIcons";
import Modal from "../../components/Modal";
import StorageSpaceIcon, {
  storageSpaceIconPresets,
} from "../../components/StorageSpaceIcon";
import UiButton from "../../components/ui/UiButton";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { cx, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import type { PortalWorkspaceSpace } from "./portalWorkspaceModel";

const MAX_ICON_BYTES = 1024 * 1024;
const ALLOWED_ICON_TYPES = new Set(["image/png", "image/jpeg"]);

const presetLabels: Record<StorageSpaceIconPreset, { en: string; fr: string; de: string }> = {
  bucket: { en: "Bucket", fr: "Seau", de: "Bucket" },
  folder: { en: "Folder", fr: "Dossier", de: "Ordner" },
  archive: { en: "Archive", fr: "Archive", de: "Archiv" },
  database: { en: "Database", fr: "Base de données", de: "Datenbank" },
  media: { en: "Media", fr: "Médias", de: "Medien" },
};

export default function StorageSpaceIconPickerModal({
  accountId,
  space,
  onClose,
  onSaved,
}: {
  accountId: S3AccountSelector;
  space: PortalWorkspaceSpace;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const initialSource: StorageSpaceIconSource = space.icon?.source ?? "preset";
  const [source, setSource] = useState<StorageSpaceIconSource>(initialSource);
  const [preset, setPreset] = useState<StorageSpaceIconPreset>(space.icon?.preset ?? "bucket");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (source === "uploaded" && !file && initialSource !== "uploaded") {
      setError(t({
        en: "Choose a PNG or JPEG image.",
        fr: "Choisissez une image PNG ou JPEG.",
        de: "Wählen Sie ein PNG- oder JPEG-Bild.",
      }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (source === "uploaded" && file) {
        await uploadPortalStorageSpaceIcon(accountId, space.id, file);
      } else {
        await updatePortalStorageSpaceIcon(accountId, space.id, {
          source,
          preset: source === "preset" ? preset : null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(extractApiError(err, t({
        en: "Unable to update the Storage Space icon.",
        fr: "Impossible de mettre à jour l’icône de l’espace.",
        de: "Das Symbol des Speicherbereichs konnte nicht aktualisiert werden.",
      })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t({ en: "Storage Space icon", fr: "Icône de l’espace", de: "Speicherbereichssymbol" })}
      onClose={onClose}
      maxWidthClass="max-w-xl"
      closeOnBackdropClick={!busy}
      closeOnEscape={!busy}
    >
      <div className="space-y-5">
        <p className={cx("text-sm", uiMutedTextClass)}>
          {t({
            en: "Choose a pictogram or upload a custom PNG/JPEG image (1 MiB maximum).",
            fr: "Choisissez un pictogramme ou importez une image PNG/JPEG personnalisée (1 Mio maximum).",
            de: "Wählen Sie ein Piktogramm oder laden Sie ein eigenes PNG-/JPEG-Bild hoch (maximal 1 MiB).",
          })}
        </p>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            {t({ en: "Pictograms", fr: "Pictogrammes", de: "Piktogramme" })}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {storageSpaceIconPresets.map((candidate) => {
              const selected = source === "preset" && preset === candidate;
              return (
                <label
                  key={candidate}
                  className={cx(
                    "flex cursor-pointer flex-col items-center gap-2 rounded-md border p-3 text-xs font-semibold transition",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-[color:var(--ui-border-soft)] hover:border-primary/50",
                  )}
                >
                  <input
                    type="radio"
                    name="storage-space-icon"
                    value={candidate}
                    checked={selected}
                    onChange={() => {
                      setSource("preset");
                      setPreset(candidate);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  <StorageSpaceIcon
                    icon={{ source: "preset", preset: candidate }}
                    name={presetLabels[candidate].en}
                    size="md"
                    decorative
                  />
                  <span>{t(presetLabels[candidate])}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label
          className={cx(
            "block rounded-md border p-3",
            source === "uploaded"
              ? "border-primary bg-primary/5"
              : "border-[color:var(--ui-border-soft)]",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="radio"
              name="storage-space-icon"
              checked={source === "uploaded"}
              onChange={() => {
                setSource("uploaded");
                setError(null);
              }}
            />
            {t({ en: "Custom image", fr: "Image personnalisée", de: "Eigenes Bild" })}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            aria-label={t({ en: "Custom image file", fr: "Fichier image personnalisé", de: "Eigene Bilddatei" })}
            className="mt-3 block w-full text-sm"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setSource("uploaded");
              setError(null);
              if (nextFile && !ALLOWED_ICON_TYPES.has(nextFile.type)) {
                setFile(null);
                setError(t({ en: "The image must be a PNG or JPEG file.", fr: "L’image doit être un fichier PNG ou JPEG.", de: "Das Bild muss eine PNG- oder JPEG-Datei sein." }));
                return;
              }
              if (nextFile && nextFile.size > MAX_ICON_BYTES) {
                setFile(null);
                setError(t({ en: "The image must be 1 MiB or smaller.", fr: "L’image ne doit pas dépasser 1 Mio.", de: "Das Bild darf höchstens 1 MiB groß sein." }));
                return;
              }
              setFile(nextFile);
            }}
          />
        </label>

        {error ? <UiInlineMessage tone="error">{error}</UiInlineMessage> : null}

        <div className="flex justify-end gap-2">
          <UiButton variant="secondary" onClick={onClose} disabled={busy}>
            {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
          </UiButton>
          <UiButton onClick={save} loading={busy}>
            {t({ en: "Save icon", fr: "Enregistrer l’icône", de: "Symbol speichern" })}
          </UiButton>
        </div>
      </div>
    </Modal>
  );
}
