/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  fetchPortalCollaboratorAccessReview,
  revokePortalStorageSpaceShare,
  type PortalCollaboratorAccessReview,
  type PortalCollaboratorStorageSpaceAccess,
} from "../../api/portal";
import { createPortalRequest } from "../../api/portalRequests";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import DataTableShell, {
  dataTableDefaultActionProps,
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import {
  tableActionButtonClasses,
  tableDeleteActionClasses,
} from "../../components/tableActionClasses";
import UiBadge from "../../components/ui/UiBadge";
import UiCard from "../../components/ui/UiCard";
import UserAvatar from "../../components/UserAvatar";
import { cx, uiMutedTextClass, uiPanelMutedClass, uiTitleTextClass } from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { classifyApiError, extractApiError } from "../../utils/apiError";
import { usePortalAccountContext } from "./PortalAccountContext";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import {
  portalAccessSourceLabel,
  portalAccountRoleLabel,
  portalCollaboratorSpaceAccessSourceLabel,
  portalDateLabel,
  portalRoleLabel,
} from "./portalI18n";
import { portalRoleTone, resolvePortalWorkspacePageState } from "./portalUi";

type PendingAction =
  | { type: "revoke-access"; access: PortalCollaboratorStorageSpaceAccess }
  | { type: "request-project-removal" };

export default function PortalCollaboratorAccessPage() {
  const { userId } = useParams<{ userId: string }>();
  const { locale, t } = useI18n();
  const {
    accountIdForApi,
    hasAccountContext,
    loading: accountLoading,
    error: accountError,
  } = usePortalAccountContext();
  const parsedUserId = Number(userId);
  const validUserId = Number.isInteger(parsedUserId) && parsedUserId > 0;
  const [review, setReview] = useState<PortalCollaboratorAccessReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectRemovalRequested, setProjectRemovalRequested] = useState(false);

  const loadReview = useCallback(async () => {
    if (!accountIdForApi || !validUserId) return;
    setLoading(true);
    setReview(null);
    setError(null);
    setDenied(false);
    try {
      setReview(await fetchPortalCollaboratorAccessReview(accountIdForApi, parsedUserId));
    } catch (err) {
      console.error(err);
      const failure = classifyApiError(
        err,
        t({
          en: "Unable to load this access review.",
          fr: "Impossible de charger cette revue des accès.",
          de: "Diese Zugriffsprüfung kann nicht geladen werden.",
        }),
      );
      setDenied(failure.kind === "denied");
      setError(
        failure.kind === "denied"
          ? t({
              en: "You are not allowed to review this collaborator's access.",
              fr: "Vous n'êtes pas autorisé à revoir les accès de ce collaborateur.",
              de: "Sie dürfen den Zugriff dieses Mitarbeiters nicht prüfen.",
            })
          : failure.message,
      );
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, parsedUserId, t, validUserId]);

  useEffect(() => {
    if (!validUserId) {
      setReview(null);
      setError(
        t({
          en: "This collaborator could not be found.",
          fr: "Ce collaborateur est introuvable.",
          de: "Dieser Mitarbeiter wurde nicht gefunden.",
        }),
      );
      return;
    }
    void loadReview();
  }, [loadReview, t, validUserId]);

  const collaborator = review?.collaborator ?? null;
  const sourceDescription = useCallback(
    (source: PortalCollaboratorStorageSpaceAccess["source"]) => {
      if (source === "direct") {
        return t({
          en: "Granted specifically on this restricted space.",
          fr: "Accordé spécifiquement sur cet espace restreint.",
          de: "Speziell für diesen eingeschränkten Bereich vergeben.",
        });
      }
      if (source === "team") {
        return t({
          en: "Inherited because the space is shared with the whole project.",
          fr: "Hérité car l'espace est partagé avec toute l'équipe projet.",
          de: "Geerbt, da der Bereich mit dem gesamten Projekt geteilt wird.",
        });
      }
      if (source === "owner") {
        return t({
          en: "Inherited from ownership of this private space.",
          fr: "Hérité de la propriété de cet espace privé.",
          de: "Aus dem Eigentum an diesem privaten Bereich geerbt.",
        });
      }
      return t({
        en: "Inherited from the project manager role.",
        fr: "Hérité du rôle de gestionnaire du projet.",
        de: "Aus der Projektmanagerrolle geerbt.",
      });
    },
    [t],
  );

  const columns = useMemo<DataTableColumn<PortalCollaboratorStorageSpaceAccess>[]>(
    () => [
      {
        id: "space",
        label: t({ en: "Storage Space", fr: "Storage Space", de: "Storage Space" }),
        primary: true,
        render: (access) => <span className="block truncate">{access.storage_space_name}</span>,
      },
      {
        id: "role",
        label: t({ en: "Effective role", fr: "Rôle effectif", de: "Effektive Rolle" }),
        render: (access) => (
          <UiBadge tone={portalRoleTone(access.role)}>{portalRoleLabel(access.role, t)}</UiBadge>
        ),
      },
      {
        id: "source",
        label: t({ en: "Source", fr: "Provenance", de: "Quelle" }),
        render: (access) => (
          <span>
            <span className={uiTitleTextClass}>
              {portalCollaboratorSpaceAccessSourceLabel(access.source, t)}
            </span>
            <span className={cx("mt-0.5 block text-[11px] font-medium", uiMutedTextClass)}>
              {sourceDescription(access.source)}
            </span>
          </span>
        ),
      },
      {
        id: "action",
        label: t({ en: "Action", fr: "Action", de: "Aktion" }),
        align: "right",
        mobileRole: "actions",
        render: (access) => (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link
              to={`/portal/storage-spaces/${encodeURIComponent(access.storage_space_id)}`}
              className={tableActionButtonClasses}
              {...dataTableDefaultActionProps}
            >
              {t({ en: "Open", fr: "Ouvrir", de: "Öffnen" })}
            </Link>
            {access.can_revoke ? (
              <button
                type="button"
                className={tableDeleteActionClasses}
                disabled={busy}
                onClick={() => setPendingAction({ type: "revoke-access", access })}
              >
                {t({ en: "Remove access", fr: "Retirer l'accès", de: "Zugriff entfernen" })}
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [busy, sourceDescription, t],
  );

  const confirmRevoke = async (access: PortalCollaboratorStorageSpaceAccess) => {
    if (!accountIdForApi || !collaborator) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokePortalStorageSpaceShare(accountIdForApi, access.storage_space_id, collaborator.user_id);
      setReview((current) =>
        current
          ? {
              ...current,
              space_accesses: current.space_accesses.filter(
                (item) => item.storage_space_id !== access.storage_space_id,
              ),
            }
          : current,
      );
      setMessage(
        t({
          en: `Access to ${access.storage_space_name} was removed.`,
          fr: `L'accès à ${access.storage_space_name} a été retiré.`,
          de: `Der Zugriff auf ${access.storage_space_name} wurde entfernt.`,
        }),
      );
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setError(
        extractApiError(
          err,
          t({
            en: "Unable to remove this access.",
            fr: "Impossible de retirer cet accès.",
            de: "Dieser Zugriff kann nicht entfernt werden.",
          }),
        ),
      );
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  };

  const confirmProjectRemoval = async () => {
    if (!accountIdForApi || !collaborator) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await createPortalRequest(accountIdForApi, {
        request_type: "portal_user_removal",
        target_name: collaborator.display_name || null,
        target_email: collaborator.email,
        reason: null,
      });
      setProjectRemovalRequested(true);
      setMessage(
        t({
          en: "Project removal request sent. Track it in Help requests.",
          fr: "Demande de retrait du projet envoyée. Suivez-la dans les demandes d'aide.",
          de: "Anfrage zur Projektentfernung gesendet. Verfolgen Sie sie unter Hilfeanfragen.",
        }),
      );
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      setError(
        extractApiError(
          err,
          t({
            en: "Unable to send the project removal request.",
            fr: "Impossible d'envoyer la demande de retrait du projet.",
            de: "Die Anfrage zur Projektentfernung kann nicht gesendet werden.",
          }),
        ),
      );
      setPendingAction(null);
    } finally {
      setBusy(false);
    }
  };

  const accountState = resolvePortalWorkspacePageState({
    accountLoading,
    loading: false,
    accountError,
    error: null,
    hasAccountContext,
    loadingMessage: t({
      en: "Loading access review...",
      fr: "Chargement de la revue des accès...",
      de: "Zugriffsprüfung wird geladen...",
    }),
    noAccountMessage: t({
      en: "Select a project to review collaborator access.",
      fr: "Sélectionnez un projet pour revoir les accès d'un collaborateur.",
      de: "Wählen Sie ein Projekt aus, um den Mitarbeiterzugriff zu prüfen.",
    }),
  });
  if (accountState) return accountState;

  const tableStatus: "loading" | "error" | "empty" | "ready" = loading
    ? "loading"
    : error || !review
      ? "error"
      : review.space_accesses.length === 0
        ? "empty"
        : "ready";
  const title = collaborator?.display_name || collaborator?.email || t({
    en: "Access review",
    fr: "Revue des accès",
    de: "Zugriffsprüfung",
  });

  return (
    <PageShell
      title={title}
      description={t({
        en: "Review effective access across active Storage Spaces and remove eligible direct grants.",
        fr: "Revoyez les accès effectifs aux Storage Spaces actifs et retirez les grants directs éligibles.",
        de: "Prüfen Sie den effektiven Zugriff auf aktive Storage Spaces und entfernen Sie berechtigte direkte Freigaben.",
      })}
      breadcrumbs={portalBreadcrumbs(
        {
          label: t({ en: "Collaborators", fr: "Collaborateurs", de: "Mitwirkende" }),
          to: "/portal/shares",
        },
        { label: title },
      )}
      actions={[
        {
          label: t({ en: "Back to members", fr: "Retour aux membres", de: "Zurück zu Mitgliedern" }),
          to: "/portal/shares",
          variant: "secondary",
        },
        ...(review?.can_request_project_removal && !projectRemovalRequested
          ? [
              {
                label: t({
                  en: "Request project removal",
                  fr: "Demander le retrait du projet",
                  de: "Projektentfernung anfragen",
                }),
                onClick: () => setPendingAction({ type: "request-project-removal" }),
                variant: "danger" as const,
                disabled: busy,
              },
            ]
          : []),
      ]}
    >
      {error ? <PageBanner tone={denied ? "warning" : "error"}>{error}</PageBanner> : null}
      {message ? <PageBanner tone="success">{message}</PageBanner> : null}

      {collaborator ? (
        <UiCard>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <UserAvatar
              avatar={collaborator.avatar}
              name={collaborator.display_name || collaborator.email}
              email={collaborator.email}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate ui-subtitle">{collaborator.display_name || collaborator.email}</p>
              <p className={cx("truncate ui-caption", uiMutedTextClass)}>{collaborator.email}</p>
            </div>
          </div>
          <dl className={cx("mt-4 grid gap-3 p-4 sm:grid-cols-3", uiPanelMutedClass)}>
            <div>
              <dt className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>
                {t({ en: "Project role", fr: "Rôle projet", de: "Projektrolle" })}
              </dt>
              <dd className="mt-1 ui-body">{portalAccountRoleLabel(collaborator.portal_role, t)}</dd>
            </div>
            <div>
              <dt className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>
                {t({ en: "Membership source", fr: "Provenance de l'adhésion", de: "Mitgliedschaftsquelle" })}
              </dt>
              <dd className="mt-1 ui-body">{portalAccessSourceLabel(collaborator.access_source, t)}</dd>
            </div>
            <div>
              <dt className={cx("ui-caption font-semibold uppercase", uiMutedTextClass)}>
                {t({ en: "Member since", fr: "Membre depuis", de: "Mitglied seit" })}
              </dt>
              <dd className="mt-1 ui-body">{portalDateLabel(collaborator.member_since, locale)}</dd>
            </div>
          </dl>
        </UiCard>
      ) : null}

      <ListPageSection
        title={t({ en: "Active Storage Space access", fr: "Accès aux Storage Spaces actifs", de: "Zugriff auf aktive Storage Spaces" })}
        description={t({
          en: "Inherited access is explained here and cannot be removed individually.",
          fr: "Les accès hérités sont expliqués ici et ne peuvent pas être retirés individuellement.",
          de: "Geerbter Zugriff wird hier erklärt und kann nicht einzeln entfernt werden.",
        })}
        countLabel={review ? t({
          en: `${review.space_accesses.length} space${review.space_accesses.length === 1 ? "" : "s"}`,
          fr: `${review.space_accesses.length} espace${review.space_accesses.length > 1 ? "s" : ""}`,
          de: `${review.space_accesses.length} Bereich${review.space_accesses.length === 1 ? "" : "e"}`,
        }) : undefined}
      >
        <DataTableShell
          columns={columns}
          rows={review?.space_accesses ?? []}
          rowKey={(access) => access.storage_space_id}
          status={tableStatus}
          loadingMessage={t({
            en: "Loading active access...",
            fr: "Chargement des accès actifs...",
            de: "Aktiver Zugriff wird geladen...",
          })}
          errorMessage={error ?? t({
            en: "Unable to load this access review.",
            fr: "Impossible de charger cette revue des accès.",
            de: "Diese Zugriffsprüfung kann nicht geladen werden.",
          })}
          emptyMessage={t({
            en: "This collaborator has no access to an active Storage Space.",
            fr: "Ce collaborateur n'a accès à aucun Storage Space actif.",
            de: "Dieser Mitarbeiter hat keinen Zugriff auf einen aktiven Storage Space.",
          })}
          responsiveCards
        />
      </ListPageSection>

      {pendingAction?.type === "revoke-access" ? (
        <ConfirmActionDialog
          title={t({ en: "Remove direct access", fr: "Retirer l'accès direct", de: "Direkten Zugriff entfernen" })}
          description={t({
            en: "Confirm that this collaborator should lose their direct access to this restricted space.",
            fr: "Confirmez que ce collaborateur doit perdre son accès direct à cet espace restreint.",
            de: "Bestätigen Sie, dass dieser Mitarbeiter den direkten Zugriff auf diesen eingeschränkten Bereich verlieren soll.",
          })}
          confirmLabel={t({ en: "Remove access", fr: "Retirer l'accès", de: "Zugriff entfernen" })}
          loading={busy}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person" }), value: title },
            { label: t({ en: "Space", fr: "Espace", de: "Bereich" }), value: pendingAction.access.storage_space_name },
            { label: t({ en: "Role", fr: "Rôle", de: "Rolle" }), value: portalRoleLabel(pendingAction.access.role, t) },
          ]}
          impacts={[
            t({
              en: "Access to this Storage Space is removed immediately.",
              fr: "L'accès à ce Storage Space est retiré immédiatement.",
              de: "Der Zugriff auf diesen Storage Space wird sofort entfernt.",
            }),
            t({
              en: "Project membership and access to other spaces are unchanged.",
              fr: "L'adhésion au projet et les accès aux autres espaces restent inchangés.",
              de: "Projektmitgliedschaft und Zugriff auf andere Bereiche bleiben unverändert.",
            }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => confirmRevoke(pendingAction.access)}
        />
      ) : null}

      {pendingAction?.type === "request-project-removal" && collaborator ? (
        <ConfirmActionDialog
          title={t({ en: "Request project removal", fr: "Demander le retrait du projet", de: "Projektentfernung anfragen" })}
          description={t({
            en: "Send this project membership removal request to a storage admin for approval.",
            fr: "Envoyez cette demande de retrait du projet à un administrateur du stockage pour approbation.",
            de: "Senden Sie diese Anfrage zur Entfernung aus dem Projekt an einen Speicheradministrator.",
          })}
          confirmLabel={t({ en: "Send request", fr: "Envoyer la demande", de: "Anfrage senden" })}
          loading={busy}
          details={[
            { label: t({ en: "Person", fr: "Personne", de: "Person" }), value: title },
            { label: t({ en: "Email", fr: "E-mail", de: "E-Mail" }), value: collaborator.email },
          ]}
          impacts={[
            t({
              en: "Nothing changes until a storage admin approves the request.",
              fr: "Rien ne change tant qu'un administrateur du stockage n'a pas approuvé la demande.",
              de: "Bis zur Genehmigung durch einen Speicheradministrator ändert sich nichts.",
            }),
            t({
              en: "Approval removes direct project membership and Portal access for this project.",
              fr: "L'approbation retire l'adhésion directe et l'accès Portal à ce projet.",
              de: "Die Genehmigung entfernt die direkte Projektmitgliedschaft und den Portal-Zugriff für dieses Projekt.",
            }),
          ]}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmProjectRemoval}
        />
      ) : null}
    </PageShell>
  );
}
