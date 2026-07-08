/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import {
  type PortalStorageSpaceCreate,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceRole,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceShareScope,
  type PortalStorageSpaceVisibility,
} from "../../api/portal";
import UiBadge from "../../components/ui/UiBadge";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
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

export function portalAccessModeFromParts(
  visibility?: PortalStorageSpaceVisibility | null,
  shareScope?: PortalStorageSpaceShareScope | null,
): PortalAccessMode {
  if (visibility !== "shared") return "private";
  return shareScope === "account" ? "account" : "restricted";
}

export function portalAccessPayloadFromMode(
  mode: PortalAccessMode,
  accountMemberRole?: PortalStorageSpaceAccountMemberRole | null,
): Pick<PortalStorageSpaceCreate, "visibility" | "share_scope" | "account_member_role"> {
  return {
    visibility: mode === "private" ? "private" : "shared",
    share_scope: mode === "account" ? "account" : "restricted",
    account_member_role: mode === "account" ? accountMemberRole ?? "Editor" : null,
  };
}

export function portalAccessModeDescription(mode: PortalAccessMode, t: ReturnType<typeof useI18n>["t"]): string {
  if (mode === "account") {
    return t({
      en: "Everyone already added to this account can work in the space automatically.",
      fr: "Toutes les personnes déjà ajoutées à ce compte peuvent travailler dans cet espace automatiquement.",
      de: "Alle bereits zu diesem Konto hinzugefügten Personen können automatisch in diesem Bereich arbeiten.",
    });
  }
  if (mode === "restricted") {
    return t({
      en: "Only the people you choose can work in this space.",
      fr: "Seules les personnes que vous choisissez peuvent travailler dans cet espace.",
      de: "Nur die von Ihnen ausgewählten Personen können in diesem Bereich arbeiten.",
    });
  }
  return t({
    en: "Only you can access this space until you invite collaborators.",
    fr: "Vous seul pouvez accéder à cet espace tant que vous n'invitez pas de collaborateurs.",
    de: "Nur Sie können auf diesen Bereich zugreifen, bis Sie Mitwirkende einladen.",
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
        en: `Team: ${memberCount} member${memberCount > 1 ? "s" : ""}`,
        fr: `Équipe : ${memberCount} membre${memberCount > 1 ? "s" : ""}`,
        de: `Team: ${memberCount} Mitglied${memberCount > 1 ? "er" : ""}`,
      });
    }
    return t({ en: "Team: all account members", fr: "Équipe : tous les membres du compte", de: "Team: alle Kontomitglieder" });
  }
  if (mode === "restricted") {
    return t({
      en: `Selected people: ${selectedCount}`,
      fr: `Personnes choisies : ${selectedCount}`,
      de: `Ausgewählte Personen: ${selectedCount}`,
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
          label={t({ en: "People", fr: "Personnes", de: "Personen" })}
          size="compact"
          className="h-9"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t({ en: "Search people by name or email...", fr: "Rechercher une personne par nom ou email...", de: "Personen nach Name oder E-Mail suchen..." })}
        />
        <div className={cx("self-center text-[11px] font-semibold", uiMutedTextClass)}>
          {selectedCount} {t({ en: "selected", fr: "sélectionné(s)", de: "ausgewählt" })}
        </div>
      </div>
      {loading ? (
        <div className={cx("text-xs font-semibold", uiMutedTextClass)}>{t({ en: "Loading people...", fr: "Chargement des personnes...", de: "Personen werden geladen..." })}</div>
      ) : error ? (
        <UiInlineMessage tone="error">{error}</UiInlineMessage>
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
                  <UiBadge tone="neutral">{t({ en: "Already invited", fr: "Déjà invité", de: "Bereits eingeladen" })}</UiBadge>
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
                en: "No person matches this search. Ask an admin to add external collaborators to the account first.",
                fr: "Aucune personne ne correspond à cette recherche. Demandez d'abord à un administrateur d'ajouter les collaborateurs externes au compte.",
                de: "Keine Person passt zu dieser Suche. Bitten Sie zuerst einen Admin, externe Mitwirkende zum Konto hinzuzufügen.",
              })
            : t({
                en: "Only people already added to this account can be invited here. Ask an admin to add external collaborators first.",
                fr: "Seules les personnes déjà ajoutées à ce compte peuvent être invitées ici. Demandez d'abord à un administrateur d'ajouter les collaborateurs externes.",
                de: "Nur bereits zu diesem Konto hinzugefügte Personen können hier eingeladen werden. Bitten Sie zuerst einen Admin, externe Mitwirkende hinzuzufügen.",
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
