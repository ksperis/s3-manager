/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useState } from "react";
import {
  type PortalStorageSpaceCreate,
  type PortalStorageSpaceAccountMemberRole,
  type PortalStorageSpaceGrantRole,
  type PortalStorageSpaceShareCandidate,
  type PortalStorageSpaceShareScope,
  type PortalStorageSpaceVisibility,
} from "../../api/portal";
import Modal from "../../components/Modal";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
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
export type PortalSelectedShare = { user_id: number; role: PortalStorageSpaceGrantRole };

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
    en: "Only you and project managers can access this space.",
    fr: "Seuls vous et les gestionnaires du projet pouvez accéder à cet espace.",
    de: "Nur Sie und die Projektmanager können auf diesen Bereich zugreifen.",
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
  return t({ en: "Private: you and project managers", fr: "Privé : vous et les gestionnaires du projet", de: "Privat: Sie und Projektmanager" });
}

export function PortalAccessModeFields({
  mode,
  onModeChange,
  accountMemberRole,
  onAccountMemberRoleChange,
  disabled = false,
  modeLocked = false,
  allowedModes = ["private", "account", "restricted"],
  modeLabel,
  roleLabel,
}: {
  mode: PortalAccessMode;
  onModeChange: (mode: PortalAccessMode) => void;
  accountMemberRole: PortalStorageSpaceAccountMemberRole;
  onAccountMemberRoleChange: (role: PortalStorageSpaceAccountMemberRole) => void;
  disabled?: boolean;
  modeLocked?: boolean;
  allowedModes?: PortalAccessMode[];
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
        disabled={disabled || modeLocked}
      >
        {allowedModes.includes("private") ? <option value="private">{portalShareScopeLabel("private", "restricted", t)}</option> : null}
        {allowedModes.includes("account") ? <option value="account">{portalShareScopeLabel("shared", "account", t)}</option> : null}
        {allowedModes.includes("restricted") ? <option value="restricted">{portalShareScopeLabel("shared", "restricted", t)}</option> : null}
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
  onRequestPerson,
}: {
  candidates: PortalStorageSpaceShareCandidate[];
  selectedRolesByUserId: Record<number, PortalStorageSpaceGrantRole>;
  query: string;
  loading?: boolean;
  error?: string | null;
  includeAlreadyShared?: boolean;
  onQueryChange: (value: string) => void;
  onRoleChange: (userId: number, role: PortalStorageSpaceGrantRole | null) => void;
  onRequestPerson?: (payload: { targetName: string; targetEmail: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const term = query.trim().toLowerCase();
  const queryLooksLikeEmail = /\S+@\S+\.\S+/.test(query.trim());
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const visibleCandidates = candidates.filter((candidate) => {
    if (!includeAlreadyShared && candidate.already_shared) return false;
    if (!term) return true;
    return [candidate.email, candidate.display_name, candidate.account_role]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term));
  });
  const selectedCount = Object.keys(selectedRolesByUserId).length;
  useEffect(() => {
    if (!requestOpen) return;
    const trimmed = query.trim();
    if (queryLooksLikeEmail && !requestEmail) {
      setRequestEmail(trimmed);
    } else if (!queryLooksLikeEmail && !requestName) {
      setRequestName(trimmed);
    }
  }, [query, queryLooksLikeEmail, requestEmail, requestName, requestOpen]);
  const openRequestForm = () => {
    const trimmed = query.trim();
    setRequestOpen(true);
    setRequestError(null);
    if (queryLooksLikeEmail) {
      setRequestEmail((current) => current || trimmed);
    } else {
      setRequestName((current) => current || trimmed);
    }
  };
  const closeRequestForm = () => {
    if (requestBusy) return;
    setRequestOpen(false);
    setRequestError(null);
  };
  const submitRequest = async () => {
    if (!onRequestPerson || !requestName.trim() || !requestEmail.trim()) return;
    setRequestBusy(true);
    setRequestError(null);
    try {
      await onRequestPerson({ targetName: requestName.trim(), targetEmail: requestEmail.trim() });
      setRequestOpen(false);
      setRequestName("");
      setRequestEmail("");
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : t({ en: "Unable to send the request.", fr: "Impossible d'envoyer la demande.", de: "Anfrage kann nicht gesendet werden." }));
    } finally {
      setRequestBusy(false);
    }
  };
  const requestCta = onRequestPerson ? (
    <div className="space-y-3 rounded-md border border-[color:var(--ui-border-soft)] bg-[var(--ui-surface)] p-3">
      <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
        {t({
          en: "Need someone who is not listed? Ask an admin to add them to this project, then you can invite them to the space.",
          fr: "Besoin d'une personne absente de la liste ? Demandez à un admin de l'ajouter au projet, puis vous pourrez l'inviter dans l'espace.",
          de: "Fehlt eine Person in der Liste? Bitten Sie einen Admin, sie zum Projekt hinzuzufügen; danach können Sie sie in den Bereich einladen.",
        })}
      </div>
      <UiButton size="sm" variant="secondary" onClick={openRequestForm}>
        {t({ en: "Request collaborator access", fr: "Demander l'ajout d'un collaborateur", de: "Mitwirkenden-Zugriff anfragen" })}
      </UiButton>
    </div>
  ) : null;
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
                    onChange={(event) => onRoleChange(candidate.user_id, event.target.value as PortalStorageSpaceGrantRole)}
                    aria-label={t({ en: `Access for ${candidate.email}`, fr: `Accès pour ${candidate.email}`, de: `Zugriff für ${candidate.email}` })}
                  >
                    <option value="Viewer">{portalRoleLabel("Viewer", t)}</option>
                    <option value="Editor">{portalRoleLabel("Editor", t)}</option>
                  </UiSelect>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <div className={cx("text-xs font-semibold", uiMutedTextClass)}>
            {term
              ? t({
                  en: "No person matches this search.",
                  fr: "Aucune personne ne correspond à cette recherche.",
                  de: "Keine Person passt zu dieser Suche.",
                })
              : t({
                  en: "Only people already added to this project can be invited here.",
                  fr: "Seules les personnes déjà ajoutées à ce projet peuvent être invitées ici.",
                  de: "Nur bereits zu diesem Projekt hinzugefügte Personen können hier eingeladen werden.",
                })}
          </div>
          {requestCta}
        </div>
      )}
      {requestOpen ? (
        <Modal
          title={t({ en: "Request collaborator access", fr: "Demander l'ajout d'un collaborateur", de: "Mitwirkenden-Zugriff anfragen" })}
          onClose={closeRequestForm}
          closeOnBackdropClick={!requestBusy}
          closeOnEscape={!requestBusy}
        >
          <div className="space-y-4">
            <p className={cx("text-xs font-semibold leading-5", uiMutedTextClass)}>
              {t({
                en: "Ask an admin to add this person to the project. Once they are added, you can invite them to the space.",
                fr: "Demandez à un admin d'ajouter cette personne au projet. Une fois ajoutée, vous pourrez l'inviter dans l'espace.",
                de: "Bitten Sie einen Admin, diese Person zum Projekt hinzuzufügen. Danach können Sie sie in den Bereich einladen.",
              })}
            </p>
            {requestError ? <UiInlineMessage tone="error">{requestError}</UiInlineMessage> : null}
            <UiInput
              label={t({ en: "Name", fr: "Nom", de: "Name" })}
              size="compact"
              className="h-9"
              value={requestName}
              onChange={(event) => setRequestName(event.target.value)}
              placeholder={t({ en: "Collaborator name", fr: "Nom du collaborateur", de: "Name des Mitwirkenden" })}
            />
            <UiInput
              label={t({ en: "Email", fr: "Email", de: "E-Mail" })}
              size="compact"
              className="h-9"
              value={requestEmail}
              onChange={(event) => setRequestEmail(event.target.value)}
              placeholder="name@example.org"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <UiButton variant="secondary" onClick={closeRequestForm} disabled={requestBusy}>
                {t({ en: "Cancel", fr: "Annuler", de: "Abbrechen" })}
              </UiButton>
              <UiButton disabled={!requestName.trim() || !requestEmail.trim() || requestBusy} loading={requestBusy} onClick={submitRequest}>
                {requestBusy ? t({ en: "Sending...", fr: "Envoi...", de: "Wird gesendet..." }) : t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden" })}
              </UiButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function selectedPortalShares(rolesByUserId: Record<number, PortalStorageSpaceGrantRole>): PortalSelectedShare[] {
  return Object.entries(rolesByUserId)
    .map(([userId, role]) => ({ user_id: Number(userId), role }))
    .filter((entry) => Number.isFinite(entry.user_id));
}

export function PortalRoleBadge({ role }: { role: PortalStorageSpaceGrantRole }) {
  const { t } = useI18n();
  return <UiBadge tone={portalRoleTone(role)}>{portalRoleLabel(role, t)}</UiBadge>;
}
