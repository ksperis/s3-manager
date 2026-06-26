/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { I18nMessage } from "../../i18n";
import type { UiLanguage } from "../../components/language";
import type { PortalStorageSpaceVisibility } from "../../api/portal";
import type {
  PortalWorkspaceRole,
  PortalWorkspaceStatus,
  PortalWorkspaceTransfer,
} from "./portalWorkspaceModel";

type TFunction = (message: I18nMessage) => string;

export function portalIntlLocale(locale: UiLanguage): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "de") return "de-DE";
  return "en-US";
}

export function portalRoleLabel(role: PortalWorkspaceRole, t: TFunction): string {
  if (role === "Owner") return t({ en: "Owner", fr: "Propriétaire", de: "Eigentümer" });
  if (role === "Editor") return t({ en: "Editor", fr: "Éditeur", de: "Bearbeiter" });
  return t({ en: "Viewer", fr: "Lecteur", de: "Betrachter" });
}

export function portalStatusLabel(status: PortalWorkspaceStatus | "Archived", t: TFunction): string {
  if (status === "Archived") return t({ en: "Archived", fr: "Archivé", de: "Archiviert" });
  if (status === "Attention") return t({ en: "Attention", fr: "Attention", de: "Achtung" });
  return t({ en: "Active", fr: "Actif", de: "Aktiv" });
}

export function portalVisibilityLabel(visibility: PortalStorageSpaceVisibility, t: TFunction): string {
  return visibility === "shared"
    ? t({ en: "Shared", fr: "Partagé", de: "Geteilt" })
    : t({ en: "Private", fr: "Privé", de: "Privat" });
}

export function portalTransferDirectionLabel(direction: PortalWorkspaceTransfer["direction"], t: TFunction): string {
  return direction === "Upload"
    ? t({ en: "Upload", fr: "Envoi", de: "Upload" })
    : t({ en: "Download", fr: "Téléchargement", de: "Download" });
}

export function portalTransferStatusLabel(status: PortalWorkspaceTransfer["status"], t: TFunction): string {
  if (status === "Completed") return t({ en: "Completed", fr: "Terminé", de: "Abgeschlossen" });
  if (status === "Uploading") return t({ en: "Uploading", fr: "Envoi en cours", de: "Upload läuft" });
  if (status === "Queued") return t({ en: "Queued", fr: "En attente", de: "In Warteschlange" });
  return t({ en: "Failed", fr: "Échec", de: "Fehlgeschlagen" });
}

export function portalTransferEtaLabel(label: string, t: TFunction): string {
  if (label === "Completed") return t({ en: "Completed", fr: "Terminé", de: "Abgeschlossen" });
  if (label === "Queued") return t({ en: "Queued", fr: "En attente", de: "In Warteschlange" });
  if (label === "In progress") return t({ en: "In progress", fr: "En cours", de: "In Bearbeitung" });
  return label;
}

export function portalAccessKeyStatusLabel(status: string | null | undefined, active: boolean, t: TFunction): string {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "active" || normalized === "enabled") return t({ en: "Active", fr: "Active", de: "Aktiv" });
  if (normalized === "inactive" || normalized === "disabled" || normalized === "suspended") {
    return t({ en: "Inactive", fr: "Inactive", de: "Inaktiv" });
  }
  return active ? t({ en: "Active", fr: "Active", de: "Aktiv" }) : t({ en: "Inactive", fr: "Inactive", de: "Inaktiv" });
}

export function portalPublicLinkStatusLabel(status: string, t: TFunction): string {
  if (status === "Active") return t({ en: "Active", fr: "Actif", de: "Aktiv" });
  if (status === "Revoked") return t({ en: "Revoked", fr: "Révoqué", de: "Widerrufen" });
  if (status === "Expired") return t({ en: "Expired", fr: "Expiré", de: "Abgelaufen" });
  return status;
}

export function portalSeverityLabel(label: string | null | undefined, t: TFunction): string {
  if (label === "Critical") return t({ en: "Critical", fr: "Critique", de: "Kritisch" });
  if (label === "Warning") return t({ en: "Warning", fr: "Avertissement", de: "Warnung" });
  if (label === "Info") return t({ en: "Info", fr: "Info", de: "Info" });
  return label ?? t({ en: "Info", fr: "Info", de: "Info" });
}

export function portalActivityActionLabel(action: string, t: TFunction): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === "uploaded") return t({ en: "Uploaded", fr: "A envoyé", de: "Hochgeladen" });
  if (normalized === "downloaded") return t({ en: "Downloaded", fr: "A téléchargé", de: "Heruntergeladen" });
  if (normalized === "deleted") return t({ en: "Deleted", fr: "A supprimé", de: "Gelöscht" });
  if (normalized === "shared") return t({ en: "Shared", fr: "A partagé", de: "Freigegeben" });
  if (normalized === "created folder") return t({ en: "Created folder", fr: "A créé un dossier", de: "Ordner erstellt" });
  if (normalized === "created storage space") return t({ en: "Created storage space", fr: "A créé un espace de stockage", de: "Speicherbereich erstellt" });
  if (normalized === "updated storage space") return t({ en: "Updated storage space", fr: "A mis à jour un espace de stockage", de: "Speicherbereich aktualisiert" });
  if (normalized === "archived storage space") return t({ en: "Archived storage space", fr: "A archivé un espace de stockage", de: "Speicherbereich archiviert" });
  if (normalized === "restored storage space") return t({ en: "Restored storage space", fr: "A restauré un espace de stockage", de: "Speicherbereich wiederhergestellt" });
  if (normalized === "updated share") return t({ en: "Updated share", fr: "A mis à jour un partage", de: "Freigabe aktualisiert" });
  if (normalized === "removed share") return t({ en: "Removed share", fr: "A retiré un partage", de: "Freigabe entfernt" });
  if (normalized === "created public link") return t({ en: "Created public link", fr: "A créé un lien public", de: "Öffentlichen Link erstellt" });
  if (normalized === "revoked public link") return t({ en: "Revoked public link", fr: "A révoqué un lien public", de: "Öffentlichen Link widerrufen" });
  if (normalized === "create portal access key") return t({ en: "Created access key", fr: "A créé une clé d'accès", de: "Zugriffsschlüssel erstellt" });
  if (normalized === "update portal access key status") return t({ en: "Updated access key status", fr: "A mis à jour le statut d'une clé d'accès", de: "Zugriffsschlüsselstatus aktualisiert" });
  if (normalized === "delete portal access key") return t({ en: "Deleted access key", fr: "A supprimé une clé d'accès", de: "Zugriffsschlüssel gelöscht" });
  return action;
}

export function portalTrendPeriodLabel(label: string | null | undefined, t: TFunction): string {
  const normalized = (label ?? "").trim().toLowerCase();
  if (normalized === "last 30 days") return t({ en: "last 30 days", fr: "les 30 derniers jours", de: "den letzten 30 Tagen" });
  if (normalized === "last week") return t({ en: "last week", fr: "la semaine dernière", de: "der letzten Woche" });
  if (normalized === "yesterday") return t({ en: "yesterday", fr: "hier", de: "gestern" });
  return label ?? "";
}

export function portalTimeAgoLabel(value?: string | null, locale: UiLanguage = "en", t?: TFunction): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const diffMs = Date.now() - parsed.getTime();
  if (diffMs < 60_000) return t?.({ en: "Now", fr: "Maintenant", de: "Jetzt" }) ?? "Now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t?.({ en: `${minutes}m ago`, fr: `il y a ${minutes} min`, de: `vor ${minutes} Min.` }) ?? `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t?.({ en: `${hours}h ago`, fr: `il y a ${hours} h`, de: `vor ${hours} Std.` }) ?? `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t?.({ en: `${days}d ago`, fr: `il y a ${days} j`, de: `vor ${days} Tg.` }) ?? `${days}d ago`;
  return parsed.toLocaleDateString(portalIntlLocale(locale), { month: "short", day: "numeric" });
}

export function portalDateLabel(
  value?: string | null,
  locale: UiLanguage = "en",
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(portalIntlLocale(locale), options);
}

export function portalDateTimeLabel(value?: string | null, locale: UiLanguage = "en"): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(portalIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPortalCurrency(value: number | null | undefined, currency: string | null | undefined, locale: UiLanguage): string {
  if (value == null) return "-";
  try {
    return new Intl.NumberFormat(portalIntlLocale(locale), {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || "EUR"}`;
  }
}
