/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
} from "../../api/portal";
import UiBadge from "../../components/ui/UiBadge";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import { cx, uiCheckboxClass, uiMutedTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import {
  portalAccessSourceLabel,
  portalAccountRoleLabel,
  portalRoleLabel,
  portalShareScopeLabel,
} from "./portalI18n";
import { portalRoleTone } from "./portalUi";

export type PortalAccessMode = "private" | "account" | "restricted";
export type PortalSelectedShare = { user_id: number; role: PortalStorageSpaceRole };

export function portalAccessModeDescription(mode: PortalAccessMode, t: ReturnType<typeof useI18n>["t"]): string {
  if (mode === "account") {
    return t({
      en: "Current and future Portal members of this account receive this access automatically.",
      fr: "Les membres Portal actuels et futurs de ce compte reçoivent automatiquement cet accès.",
      de: "Aktuelle und zukünftige Portal-Mitglieder dieses Kontos erhalten diesen Zugriff automatisch.",
    });
  }
  if (mode === "restricted") {
    return t({
      en: "Only selected Portal users receive access.",
      fr: "Seuls les utilisateurs Portal sélectionnés reçoivent l'accès.",
      de: "Nur ausgewählte Portal-Benutzer erhalten Zugriff.",
    });
  }
  return t({
    en: "Only the owner can access this Storage Space.",
    fr: "Seul le propriétaire peut accéder à cet espace de stockage.",
    de: "Nur der Eigentümer kann auf diesen Speicherbereich zugreifen.",
  });
}

export function portalAccessModeSummary(
  mode: PortalAccessMode,
  selectedCount: number,
  memberCount: number | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (mode === "account") {
    if (memberCount != null) {
      return t({
        en: `All: ${memberCount} account member${memberCount > 1 ? "s" : ""}`,
        fr: `Tous : ${memberCount} membre${memberCount > 1 ? "s" : ""} du compte`,
        de: `Alle: ${memberCount} Kontomitglied${memberCount > 1 ? "er" : ""}`,
      });
    }
    return t({ en: "All: all account members", fr: "Tous : tous les membres du compte", de: "Alle: alle Kontomitglieder" });
  }
  if (mode === "restricted") {
    return t({
      en: `Restricted: ${selectedCount} selected user${selectedCount > 1 ? "s" : ""}`,
      fr: `Restreint : ${selectedCount} utilisateur${selectedCount > 1 ? "s" : ""} sélectionné${selectedCount > 1 ? "s" : ""}`,
      de: `Beschränkt: ${selectedCount} ausgewählte Benutzer`,
    });
  }
  return t({ en: "Private: only you", fr: "Privé : vous uniquement", de: "Privat: nur Sie" });
}

export function PortalAccessModeFields({
  mode,
  onModeChange,
  accountMemberRole,
  onAccountMemberRoleChange,
  disabled = false,
  modeLabel,
  roleLabel,
}: {
  mode: PortalAccessMode;
  onModeChange: (mode: PortalAccessMode) => void;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
  onAccountMemberRoleChange: (role: PortalStorageSpaceAccountMemberRole) => void;
  disabled?: boolean;
  modeLabel: string;
  roleLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-[190px_150px_minmax(0,1fr)]">
      <UiSelect
        label={modeLabel}
        size="compact"
        className="h-9"
        value={mode}
        onChange={(event) => onModeChange(event.target.value as PortalAccessMode)}
        disabled={disabled}
      >
        <option value="private">{portalShareScopeLabel("private", "restricted", t)}</option>
        <option value="account">{portalShareScopeLabel("shared", "account", t)}</option>
        <option value="restricted">{portalShareScopeLabel("shared", "restricted", t)}</option>
      </UiSelect>
      <UiSelect
        label={roleLabel}
        size="compact"
        className="h-9"
        value={accountMemberRole}
        onChange={(event) => onAccountMemberRoleChange(event.target.value as PortalStorageSpaceAccountMemberRole)}
        disabled={disabled || mode !== "account"}
      >
        <option value="Editor">{portalRoleLabel("Editor", t)}</option>
        <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
      </UiSelect>
      <div className={cx("self-center text-xs font-medium", uiMutedTextClass)}>
        {portalAccessModeDescription(mode, t)}
      </div>
    </div>
  );
}

export function PortalShareCandidatePicker({
  candidates,
  selectedRolesByUserId,
  query,
  loading = false,
  error,
  includeAlreadyShared = false,
  onQueryChange,
  onRoleChange,
}: {
  candidates: PortalStorageSpaceShareCandidate[];
  selectedRolesByUserId: Record<number, PortalStorageSpaceRole>;
  query: string;
  loading?: boolean;
  error?: string | null;
  includeAlreadyShared?: boolean;
  onQueryChange: (value: string) => void;
  onRoleChange: (userId: number, role: PortalStorageSpaceRole | null) => void;
}) {
  const { t } = useI18n();
  const term = query.trim().toLowerCase();
  const visibleCandidates = candidates.filter((candidate) => {
    if (!includeAlreadyShared && candidate.already_shared) return false;
    if (!term) return true;
    return [candidate.email, candidate.display_name, candidate.account_role]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
  const selectedCount = Object.keys(selectedRolesByUserId).length;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto]">
        <UiInput
          label={t({ en: "Eligible users", fr: "Utilisateurs éligibles", de: "Berechtigte Benutzer" })}
          size="compact"
          className="h-9"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t({ en: "Search eligible Portal users...", fr: "Rechercher des utilisateurs Portal éligibles...", de: "Berechtigte Portal-Benutzer suchen..." })}
        />
        <div className={cx("self-center text-[11px] font-semibold", uiMutedTextClass)}>
          {selectedCount} {t({ en: "selected", fr: "sélectionné(s)", de: "ausgewählt" })}
        </div>
      </div>
      {loading ? (
        <div className={cx("text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Loading eligible users...", fr: "Chargement des utilisateurs éligibles...", de: "Berechtigte Benutzer werden geladen..." })}</div>
      ) : error ? (
        <div className="text-xs font-semibold text-rose-600 dark:text-rose-300">{error}</div>
      ) : visibleCandidates.length > 0 ? (
        <div className="max-h-56 overflow-y-auto rounded-md border border-[color:var(--ui-border)]">
          {visibleCandidates.map((candidate) => {
            const selectedRole = selectedRolesByUserId[candidate.user_id] ?? null;
            const disabled = Boolean(candidate.already_shared);
            return (
              <div key={candidate.user_id} className="grid gap-2 border-b border-[color:var(--ui-border-soft)] px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_130px]">
                <label className={cx("flex min-w-0 items-center gap-2 text-xs font-semibold", disabled && "opacity-60")}>
                  <input
                    type="checkbox"
                    className={uiCheckboxClass}
                    checked={Boolean(selectedRole) || disabled}
                    disabled={disabled}
                    onChange={(event) => onRoleChange(candidate.user_id, event.target.checked ? "Viewer" : null)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{candidate.display_name || candidate.email}</span>
                    <span className={cx("block truncate text-[11px] font-medium", uiMutedTextClass)}>{candidate.email}</span>
                  </span>
                </label>
                <div className={cx("self-center text-[11px] font-semibold", uiMutedTextClass)}>
                  {portalAccountRoleLabel(candidate.account_role, t)} · {portalAccessSourceLabel(candidate.access_source, t)}
                </div>
                {disabled ? (
                  <UiBadge tone="neutral">{t({ en: "Already shared", fr: "Déjà partagé", de: "Bereits geteilt" })}</UiBadge>
                ) : (
                  <UiSelect
                    size="compact"
                    className="h-8"
                    value={selectedRole ?? "Viewer"}
                    disabled={!selectedRole}
                    onChange={(event) => onRoleChange(candidate.user_id, event.target.value as PortalStorageSpaceRole)}
                    aria-label={t({ en: `Access for ${candidate.email}`, fr: `Accès pour ${candidate.email}`, de: `Zugriff für ${candidate.email}` })}
                  >
                    <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                    <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                    <option value="Owner">{portalRoleLabel("Owner", t)}</option>
                  </UiSelect>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
          {term
            ? t({
                en: "No eligible Portal member matches this search. To add someone else, request account access from an admin.",
                fr: "Aucun membre Portal éligible ne correspond à cette recherche. Pour ajouter une autre personne, demandez un accès au compte à un administrateur.",
                de: "Kein berechtigtes Portal-Mitglied passt zu dieser Suche. Fordern Sie für andere Personen Kontozugriff bei einem Admin an.",
              })
            : t({
                en: "Only Portal members of this account can be selected. To add someone else, request account access from an admin.",
                fr: "Seuls les membres Portal de ce compte peuvent être sélectionnés. Pour ajouter une autre personne, demandez un accès au compte à un administrateur.",
                de: "Nur Portal-Mitglieder dieses Kontos können ausgewählt werden. Fordern Sie für andere Personen Kontozugriff bei einem Admin an.",
              })}
        </div>
      )}
    </div>
  );
}

export function selectedPortalShares(rolesByUserId: Record<number, PortalStorageSpaceRole>): PortalSelectedShare[] {
  return Object.entries(rolesByUserId)
    .map(([userId, role]) => ({ user_id: Number(userId), role }))
    .filter((entry) => Number.isFinite(entry.user_id));
}

export function PortalRoleBadge({ role }: { role: PortalStorageSpaceRole }) {
  const { t } = useI18n();
  return <UiBadge tone={portalRoleTone(role)}>{portalRoleLabel(role, t)}</UiBadge>;
}
