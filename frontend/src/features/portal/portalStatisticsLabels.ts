/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { useI18n } from "../../i18n";
import type { BucketUsageStatsCompositionLabels } from "../shared/BucketUsageStatsVisuals";

type PortalTranslate = ReturnType<typeof useI18n>["t"];

export function portalUsageCompositionLabels(t: PortalTranslate): BucketUsageStatsCompositionLabels {
  return {
    logicalBytes: t({ en: "Stored data", fr: "Données stockées", de: "Gespeicherte Daten" }),
    currentBytes: t({ en: "Current files", fr: "Fichiers courants", de: "Aktuelle Dateien" }),
    noncurrentBytes: t({ en: "Older versions", fr: "Anciennes versions", de: "Ältere Versionen" }),
    versionsUnit: t({ en: "versions", fr: "versions", de: "Versionen" }),
    unavailable: t({ en: "Unavailable", fr: "Indisponible", de: "Nicht verfügbar" }),
    versionListingWarning: t({
      en: "Older file versions could not be listed, so their storage distribution is unavailable.",
      fr: "Les anciennes versions de fichiers n’ont pas pu être listées : leur répartition de stockage est indisponible.",
      de: "Ältere Dateiversionen konnten nicht aufgelistet werden; ihre Speicherverteilung ist nicht verfügbar.",
    }),
    dataTypesTitle: t({ en: "File types", fr: "Types de fichiers", de: "Dateitypen" }),
    dataTypesSubtitle: t({ en: "Stored data by inferred file type", fr: "Données stockées par type de fichier détecté", de: "Gespeicherte Daten nach erkanntem Dateityp" }),
    currentVsNoncurrentTitle: t({ en: "Current and older versions", fr: "Versions courantes et anciennes", de: "Aktuelle und ältere Versionen" }),
    currentVsNoncurrentSubtitle: t({ en: "Storage used by file history", fr: "Stockage utilisé par l’historique des fichiers", de: "Vom Dateiverlauf belegter Speicher" }),
    storageClassesTitle: t({ en: "Storage classes", fr: "Classes de stockage", de: "Speicherklassen" }),
    storageClassesSubtitle: t({ en: "Stored data by storage class", fr: "Données stockées par classe de stockage", de: "Gespeicherte Daten nach Speicherklasse" }),
    objectSizesTitle: t({ en: "File sizes", fr: "Tailles des fichiers", de: "Dateigrößen" }),
    objectSizesSubtitle: t({ en: "Versions by file size", fr: "Versions par taille de fichier", de: "Versionen nach Dateigröße" }),
    objectAgeTitle: t({ en: "File age", fr: "Âge des fichiers", de: "Dateialter" }),
    objectAgeSubtitle: t({ en: "Versions by last modification date", fr: "Versions par date de dernière modification", de: "Versionen nach letzter Änderung" }),
  };
}

export function portalTrafficLabels(t: PortalTranslate) {
  return {
    egress: t({ en: "Downloaded", fr: "Téléchargé", de: "Heruntergeladen" }),
    egressHint: t({ en: "Sent out", fr: "Sorti", de: "Ausgehend" }),
    ingress: t({ en: "Uploaded", fr: "Envoyé", de: "Hochgeladen" }),
    ingressHint: t({ en: "Sent in", fr: "Entré", de: "Eingehend" }),
    successRate: t({ en: "Completed activity", fr: "Activité réussie", de: "Abgeschlossene Aktivität" }),
    summaryActivityUnit: t({ en: "actions", fr: "actions", de: "Aktionen" }),
    trafficChartTitle: t({ en: "Movement over time", fr: "Mouvements dans le temps", de: "Bewegung im Zeitverlauf" }),
    trafficChartSubtitle: t({ en: "Uploads compared with downloads", fr: "Envois comparés aux téléchargements", de: "Uploads im Vergleich zu Downloads" }),
    callVolumeTitle: t({ en: "File activity", fr: "Activité fichier", de: "Dateiaktivität" }),
    callVolumeSubtitle: t({ en: "Actions per period", fr: "Actions par période", de: "Aktionen pro Zeitraum" }),
    requestBreakdownTitle: t({ en: "Action types", fr: "Types d’actions", de: "Aktionstypen" }),
    emptyMessage: t({ en: "No upload or download activity for this window.", fr: "Aucun envoi ou téléchargement sur cette période.", de: "Keine Upload- oder Download-Aktivität in diesem Fenster." }),
    rankingActivityUnit: t({ en: "actions", fr: "actions", de: "Aktionen" }),
    successText: t({ en: "completed", fr: "réussies", de: "abgeschlossen" }),
    inboundLabel: t({ en: "Uploaded", fr: "Envoyé", de: "Hochgeladen" }),
    outboundLabel: t({ en: "Downloaded", fr: "Téléchargé", de: "Heruntergeladen" }),
    callVolumeBarName: t({ en: "Actions", fr: "Actions", de: "Aktionen" }),
  };
}

export function portalActivitySourceTitle(t: PortalTranslate): string {
  return t({ en: "Activity source", fr: "Source de l’activité", de: "Aktivitätsquelle" });
}
