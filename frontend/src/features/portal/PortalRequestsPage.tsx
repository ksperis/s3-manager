/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createPortalRequest,
  listPortalRequests,
  type PortalAdminRequest,
  type PortalQuotaDirection,
  type PortalQuotaUnit,
} from "../../api/portalRequests";
import {
  fetchPortalCollaborators,
  fetchPortalState,
  fetchPortalUsage,
  type PortalCollaborator,
  type PortalUsage,
} from "../../api/portal";
import DataTableShell, {
  type DataTableColumn,
} from "../../components/list/DataTableShell";
import ListPageSection from "../../components/list/ListPageSection";
import { resolveListTableStatus } from "../../components/list/listTableStatus";
import Modal from "../../components/Modal";
import PageBanner from "../../components/PageBanner";
import PageShell from "../../components/PageShell";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";
import UiInput from "../../components/ui/UiInput";
import UiSelect from "../../components/ui/UiSelect";
import {
  cx,
  uiDividerClass,
  uiInputClass,
  uiLabelClass,
  uiMutedTextClass,
  uiTitleTextClass,
} from "../../components/ui/styles";
import { useI18n } from "../../i18n";
import { extractApiError } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import PortalPageTabs, { PortalTabPanel } from "./PortalPageTabs";
import {
  formatPortalRequestDate,
  PortalRequestStatusBadge,
  portalRequestPayloadSummary,
  portalRequestReason,
  portalRequestTypeLabel,
} from "../shared/portalRequestsPresentation";
import { portalBreadcrumbs } from "./portalBreadcrumbs";
import { usePortalAccountContext } from "./PortalAccountContext";

type BusyAction = "collaborator" | "quota" | "refresh" | null;
type CollaboratorAction = "add" | "remove";
type RequestDialog = "collaborator" | "storage-limit" | null;
type RequestsTab = "request-help" | "history";

const quotaUnits: PortalQuotaUnit[] = ["MiB", "GiB", "TiB"];
const quotaUnitBytes: Record<PortalQuotaUnit, number> = {
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

function quotaValueToBytes(
  value: string,
  unit: PortalQuotaUnit,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed * quotaUnitBytes[unit];
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function PortalRequestsPage() {
  const { t } = useI18n();
  const {
    accountIdForApi,
    hasAccountContext,
    selectedAccount,
    loading: accountLoading,
    error: accountError,
  } = usePortalAccountContext();
  const [requests, setRequests] = useState<PortalAdminRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [requestDialog, setRequestDialog] = useState<RequestDialog>(null);
  const [activeTab, setActiveTab] = useState<RequestsTab>("request-help");
  const [collaboratorAction, setCollaboratorAction] =
    useState<CollaboratorAction>("add");
  const [targetName, setTargetName] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [targetReason, setTargetReason] = useState("");
  const [quotaDirection, setQuotaDirection] =
    useState<PortalQuotaDirection>("increase");
  const [quotaValue, setQuotaValue] = useState("");
  const [quotaUnit, setQuotaUnit] = useState<PortalQuotaUnit>("GiB");
  const [quotaReason, setQuotaReason] = useState("");
  const [portalUsage, setPortalUsage] = useState<PortalUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<PortalCollaborator[]>([]);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [collaboratorsError, setCollaboratorsError] = useState<string | null>(
    null,
  );
  const [requestPermission, setRequestPermission] = useState<{
    accountId: string;
    canManage: boolean;
  } | null>(null);
  const selectedAccountKey = accountIdForApi == null ? null : String(accountIdForApi);
  const summaryAllowsManagedRequests =
    selectedAccount?.account_role === "portal_manager";
  const stateAllowsManagedRequests =
    requestPermission?.accountId === selectedAccountKey
      ? requestPermission.canManage
      : null;
  const requestPermissionResolved =
    summaryAllowsManagedRequests || stateAllowsManagedRequests !== null;
  const canRequestManagedChanges =
    stateAllowsManagedRequests ?? summaryAllowsManagedRequests;
  const showRequestHelpTab =
    accountLoading || !requestPermissionResolved || canRequestManagedChanges;

  useEffect(() => {
    if (!hasAccountContext || !accountIdForApi || !selectedAccountKey) {
      setRequestPermission(null);
      return;
    }
    let cancelled = false;
    void fetchPortalState(accountIdForApi)
      .then((state) => {
        if (cancelled) return;
        setRequestPermission({
          accountId: selectedAccountKey,
          canManage:
            state.account_role === "portal_manager" ||
            state.can_manage_portal_users === true,
        });
      })
      .catch((err) => {
        console.error(err);
        if (cancelled) return;
        setRequestPermission({
          accountId: selectedAccountKey,
          canManage: summaryAllowsManagedRequests,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    accountIdForApi,
    hasAccountContext,
    selectedAccountKey,
    summaryAllowsManagedRequests,
  ]);

  const loadRequests = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setRequests([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRequests(await listPortalRequests(accountIdForApi));
    } catch (err) {
      console.error(err);
      setError(
        extractApiError(
          err,
          t({
            en: "Unable to load requests.",
            fr: "Impossible de charger les demandes.",
            de: "Anfragen können nicht geladen werden.",
          }),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (
      !accountLoading &&
      requestPermissionResolved &&
      hasAccountContext &&
      !canRequestManagedChanges
    ) {
      setActiveTab("history");
    }
  }, [
    accountLoading,
    canRequestManagedChanges,
    hasAccountContext,
    requestPermissionResolved,
  ]);

  const loadUsage = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi) {
      setPortalUsage(null);
      setUsageLoading(false);
      setUsageError(null);
      return;
    }
    setUsageLoading(true);
    setUsageError(null);
    try {
      setPortalUsage(await fetchPortalUsage(accountIdForApi));
    } catch (err) {
      console.error(err);
      setPortalUsage(null);
      setUsageError(
        extractApiError(
          err,
          t({
            en: "Unable to load current usage.",
            fr: "Impossible de charger l'usage actuel.",
            de: "Aktuelle Nutzung kann nicht geladen werden.",
          }),
        ),
      );
    } finally {
      setUsageLoading(false);
    }
  }, [accountIdForApi, hasAccountContext, t]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const loadCollaborators = useCallback(async () => {
    if (!hasAccountContext || !accountIdForApi || !canRequestManagedChanges) {
      setCollaborators([]);
      setCollaboratorsLoading(false);
      setCollaboratorsError(null);
      return;
    }
    setCollaboratorsLoading(true);
    setCollaboratorsError(null);
    try {
      const data = await fetchPortalCollaborators(accountIdForApi);
      setCollaborators(data.collaborators ?? []);
    } catch (err) {
      console.error(err);
      setCollaborators([]);
      setCollaboratorsError(
        extractApiError(
          err,
          t({
            en: "Unable to load collaborators.",
            fr: "Impossible de charger les collaborateurs.",
            de: "Mitwirkende konnen nicht geladen werden.",
          }),
        ),
      );
    } finally {
      setCollaboratorsLoading(false);
    }
  }, [accountIdForApi, canRequestManagedChanges, hasAccountContext, t]);

  useEffect(() => {
    void loadCollaborators();
  }, [loadCollaborators]);

  const handleRefresh = async () => {
    setBusy("refresh");
    try {
      await Promise.all([loadRequests(), loadUsage(), loadCollaborators()]);
    } finally {
      setBusy(null);
    }
  };

  const handleCollaboratorRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi) return;
    const cleanName = targetName.trim();
    const cleanEmail = targetEmail.trim();
    const cleanReason = targetReason.trim();
    if (!cleanName || !cleanEmail) return;
    setBusy("collaborator");
    setNotice(null);
    setError(null);
    try {
      await createPortalRequest(
        accountIdForApi,
        collaboratorAction === "add"
          ? {
              request_type: "portal_user_access",
              target_name: cleanName,
              target_email: cleanEmail,
              reason: cleanReason || null,
            }
          : {
              request_type: "portal_user_removal",
              target_name: cleanName,
              target_email: cleanEmail,
              reason: cleanReason || null,
            },
      );
      setTargetName("");
      setTargetEmail("");
      setTargetReason("");
      setNotice(
        t({
          en: "Request sent. You can follow its status below.",
          fr: "Demande envoyée. Vous pouvez suivre son statut ci-dessous.",
          de: "Anfrage gesendet. Sie können den Status unten verfolgen.",
        }),
      );
      setRequestDialog(null);
      setActiveTab("history");
      await loadRequests();
    } catch (err) {
      console.error(err);
      setError(
        extractApiError(
          err,
          t({
            en: "Unable to send the collaborator request.",
            fr: "Impossible d'envoyer la demande collaborateur.",
            de: "Anfrage fur Mitwirkende kann nicht gesendet werden.",
          }),
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const requestsDisabled =
    !hasAccountContext || accountLoading || Boolean(accountError);
  const currentQuotaBytes = portalUsage?.quota_max_size_bytes ?? null;
  const usedBytes = portalUsage?.used_bytes ?? null;
  const targetQuotaBytes = useMemo(
    () => quotaValueToBytes(quotaValue, quotaUnit),
    [quotaUnit, quotaValue],
  );
  const quotaBelowUsed =
    usedBytes != null &&
    targetQuotaBytes != null &&
    targetQuotaBytes < usedBytes;
  const quotaDirectionMismatch =
    currentQuotaBytes != null &&
    targetQuotaBytes != null &&
    ((quotaDirection === "increase" && targetQuotaBytes <= currentQuotaBytes) ||
      (quotaDirection === "decrease" && targetQuotaBytes >= currentQuotaBytes));
  const removableCollaborators = useMemo(
    () =>
      collaborators.filter(
        (collaborator) =>
          collaborator.account_role === "portal_user" &&
          collaborator.access_source !== "group",
      ),
    [collaborators],
  );
  const collaboratorSubmitDisabled =
    requestsDisabled ||
    !canRequestManagedChanges ||
    busy === "collaborator" ||
    !targetName.trim() ||
    !targetEmail.trim() ||
    (collaboratorAction === "remove" && removableCollaborators.length === 0);

  const openCollaboratorDialog = (action: CollaboratorAction = "add") => {
    setCollaboratorAction(action);
    setTargetName("");
    setTargetEmail("");
    setTargetReason("");
    setRequestDialog("collaborator");
  };

  const applyRemovalCollaborator = (email: string) => {
    const collaborator = removableCollaborators.find(
      (item) => item.email === email,
    );
    setTargetEmail(email);
    setTargetName(
      collaborator
        ? collaborator.display_name || collaborator.email
        : "",
    );
  };

  const handleCollaboratorActionChange = (action: CollaboratorAction) => {
    setCollaboratorAction(action);
    setTargetName("");
    setTargetEmail("");
    setTargetReason("");
  };

  const handleQuotaRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountIdForApi) return;
    const parsedQuota = Number(quotaValue);
    if (!Number.isFinite(parsedQuota) || parsedQuota <= 0) {
      setError(
        t({
          en: "Storage limit must be greater than zero.",
          fr: "La limite de stockage doit être supérieure à zéro.",
          de: "Die Speichergrenze muss größer als null sein.",
        }),
      );
      return;
    }
    if (quotaBelowUsed) {
      setError(
        t({
          en: "The requested storage limit is lower than the space already used.",
          fr: "La limite demandée est inférieure à l'espace déjà utilisé.",
          de: "Die angeforderte Speichergrenze liegt unter der bereits genutzten Kapazität.",
        }),
      );
      return;
    }
    if (quotaDirectionMismatch) {
      setError(
        quotaDirection === "increase"
          ? t({
              en: "A raise must target a limit higher than the current limit.",
              fr: "Une augmentation doit viser une limite supérieure à la limite actuelle.",
              de: "Eine Erhöhung muss über der aktuellen Grenze liegen.",
            })
          : t({
              en: "A reduction must target a limit lower than the current limit.",
              fr: "Une réduction doit viser une limite inférieure à la limite actuelle.",
              de: "Eine Senkung muss unter der aktuellen Grenze liegen.",
            }),
      );
      return;
    }
    setBusy("quota");
    setNotice(null);
    setError(null);
    try {
      await createPortalRequest(accountIdForApi, {
        request_type: "account_quota_change",
        direction: quotaDirection,
        target_quota_value: parsedQuota,
        target_quota_unit: quotaUnit,
        reason: quotaReason.trim() || null,
      });
      setQuotaValue("");
      setQuotaReason("");
      setNotice(
        t({
          en: "Request sent. You can follow its status below.",
          fr: "Demande envoyée. Vous pouvez suivre son statut ci-dessous.",
          de: "Anfrage gesendet. Sie können den Status unten verfolgen.",
        }),
      );
      setRequestDialog(null);
      setActiveTab("history");
      await loadRequests();
    } catch (err) {
      console.error(err);
      setError(
        extractApiError(
          err,
          t({
            en: "Unable to send the storage limit request.",
            fr: "Impossible d'envoyer la demande de limite de stockage.",
            de: "Anfrage zur Speichergrenze kann nicht gesendet werden.",
          }),
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const columns = useMemo<Array<DataTableColumn<PortalAdminRequest>>>(
    () => [
      {
        id: "request",
        label: t({ en: "Request", fr: "Demande", de: "Anfrage" }),
        primary: true,
        render: (request) => (
          <div className="min-w-0">
            <p className={cx("truncate ui-body", uiTitleTextClass)}>
              {portalRequestTypeLabel(request.request_type)}
            </p>
            <p className={cx("mt-1 truncate ui-caption", uiMutedTextClass)}>
              {portalRequestPayloadSummary(request)}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        label: t({ en: "Status", fr: "Statut", de: "Status" }),
        render: (request) => (
          <PortalRequestStatusBadge status={request.status} />
        ),
      },
      {
        id: "created",
        label: t({ en: "Created", fr: "Créée", de: "Erstellt" }),
        render: (request) => formatPortalRequestDate(request.created_at),
      },
      {
        id: "updated",
        label: t({ en: "Updated", fr: "Mise à jour", de: "Aktualisiert" }),
        render: (request) =>
          formatPortalRequestDate(request.decided_at ?? request.updated_at),
      },
    ],
    [t],
  );

  const tableStatus = resolveListTableStatus({
    loading,
    error,
    rowCount: requests.length,
  });
  const quotaSubmitDisabled =
    requestsDisabled ||
    !canRequestManagedChanges ||
    !targetQuotaBytes ||
    quotaBelowUsed ||
    quotaDirectionMismatch;
  const closeRequestDialog = () => {
    if (busy) return;
    setRequestDialog(null);
  };

  return (
    <PageShell
        title={t({
          en: "Help requests",
          fr: "Demandes d'aide",
          de: "Hilfeanfragen",
        })}
        description={t({
          en: "Ask the support team for help with collaborators and project storage limits.",
          fr: "Demandez de l'aide à l'équipe support pour les collaborateurs et les limites de stockage du projet.",
          de: "Bitten Sie das Support-Team um Hilfe bei Mitwirkenden und Projekt-Speichergrenzen.",
        })}
        breadcrumbs={portalBreadcrumbs({
          label: t({
            en: "Help requests",
            fr: "Demandes d'aide",
            de: "Hilfeanfragen",
          }),
        })}
    >

      {accountError ? (
        <PageBanner tone="error">{accountError}</PageBanner>
      ) : null}
      {notice ? <PageBanner tone="success">{notice}</PageBanner> : null}
      {error ? <PageBanner tone="error">{error}</PageBanner> : null}
      {usageError ? <PageBanner tone="warning">{usageError}</PageBanner> : null}
      {collaboratorsError ? (
        <PageBanner tone="warning">{collaboratorsError}</PageBanner>
      ) : null}
      {!accountLoading && hasAccountContext && !canRequestManagedChanges ? (
        <PageBanner tone="info">
          {t({
            en: "Only storage managers can submit collaborator or storage-limit requests for this project.",
            fr: "Seuls les managers du stockage peuvent envoyer des demandes collaborateur ou limite pour ce projet.",
            de: "Nur Speicher-Manager konnen fur dieses Projekt Mitwirkenden- oder Speichergrenzen-Anfragen senden.",
          })}
        </PageBanner>
      ) : null}

      <PortalPageTabs
        tabs={[
          ...(showRequestHelpTab
            ? [
                {
                  id: "request-help",
                  label: t({
                    en: "Request help",
                    fr: "Demander de l'aide",
                    de: "Hilfe anfordern",
                  }),
                },
              ]
            : []),
          {
            id: "history",
            label: t({
              en: `History (${requests.length})`,
              fr: `Historique (${requests.length})`,
              de: `Verlauf (${requests.length})`,
            }),
          },
        ]}
        activeTab={showRequestHelpTab ? activeTab : "history"}
        onChange={(tabId) => setActiveTab(tabId as RequestsTab)}
        ariaLabel={t({
          en: "Help request views",
          fr: "Vues des demandes d'aide",
          de: "Ansichten der Hilfeanfragen",
        })}
        idPrefix="portal-help-requests"
        headerActions={
          !showRequestHelpTab || activeTab === "history" ? (
            <UiButton
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              loading={busy === "refresh"}
            >
              {t({ en: "Refresh", fr: "Actualiser", de: "Aktualisieren" })}
            </UiButton>
          ) : null
        }
      />

      {showRequestHelpTab && activeTab === "request-help" ? (
        <PortalTabPanel
          idPrefix="portal-help-requests"
          tabId="request-help"
          className="grid gap-3 md:grid-cols-2"
        >
          <UiCard
            title={t({
              en: "Add or remove a collaborator",
              fr: "Ajouter ou retirer un collaborateur",
              de: "Mitwirkenden hinzufugen oder entfernen",
            })}
            description={t({
              en: "Ask support to update project membership from one shared form.",
              fr: "Demandez au support de mettre à jour les membres du projet depuis un formulaire commun.",
              de: "Bitten Sie den Support, die Projektmitglieder uber ein gemeinsames Formular zu aktualisieren.",
            })}
            actions={
              <UiButton
                size="sm"
                onClick={() => openCollaboratorDialog("add")}
                disabled={requestsDisabled || !canRequestManagedChanges}
              >
                {t({
                  en: "Manage membership",
                  fr: "Gérer les membres",
                  de: "Mitglieder verwalten",
                })}
              </UiButton>
            }
          >
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {t({
                en: "Add a new person by email, or select an existing direct collaborator to remove.",
                fr: "Ajoutez une nouvelle personne par e-mail, ou sélectionnez un collaborateur direct existant à retirer.",
                de: "Fugen Sie eine neue Person per E-Mail hinzu oder wahlen Sie einen bestehenden direkten Mitwirkenden zum Entfernen aus.",
              })}
            </p>
          </UiCard>

          <UiCard
            title={t({
              en: "Change storage limit",
              fr: "Modifier la limite",
              de: "Speichergrenze ändern",
            })}
            description={t({
              en: "Ask for more room, or lower the project limit after cleanup.",
              fr: "Demandez plus d'espace, ou réduisez la limite du projet après nettoyage.",
              de: "Fordern Sie mehr Speicher an oder senken Sie die Projektgrenze nach einer Bereinigung.",
            })}
            actions={
              <UiButton
                size="sm"
                variant="secondary"
                onClick={() => setRequestDialog("storage-limit")}
                disabled={requestsDisabled || !canRequestManagedChanges}
              >
                {t({
                  en: "Change limit",
                  fr: "Changer la limite",
                  de: "Grenze ändern",
                })}
              </UiButton>
            }
          >
            <p className={cx("ui-caption", uiMutedTextClass)}>
              {usedBytes == null
                ? t({
                    en: "Current usage will be checked before the request is sent.",
                    fr: "L'usage actuel sera vérifié avant l'envoi de la demande.",
                    de: "Die aktuelle Nutzung wird vor dem Senden geprüft.",
                  })
                : t({
                    en: `Currently used: ${formatBytes(usedBytes)}.`,
                    fr: `Actuellement utilisé : ${formatBytes(usedBytes)}.`,
                    de: `Aktuell genutzt: ${formatBytes(usedBytes)}.`,
                  })}
            </p>
          </UiCard>

        </PortalTabPanel>
      ) : null}

      {!showRequestHelpTab || activeTab === "history" ? (
        <PortalTabPanel idPrefix="portal-help-requests" tabId="history">
          <ListPageSection
            title={t({
              en: "My help requests",
              fr: "Mes demandes d'aide",
              de: "Meine Hilfeanfragen",
            })}
            showHeading
            countLabel={t({
              en: `${requests.length} request(s)`,
              fr: `${requests.length} demande(s)`,
              de: `${requests.length} Anfrage(n)`,
            })}
          >
            <DataTableShell
              columns={columns}
              rows={requests}
              rowKey={(request) => request.id}
              status={tableStatus}
              loadingMessage={t({
                en: "Loading requests...",
                fr: "Chargement des demandes...",
                de: "Anfragen werden geladen...",
              })}
              errorMessage={
                error ??
                t({
                  en: "Unable to load requests.",
                  fr: "Impossible de charger les demandes.",
                  de: "Anfragen können nicht geladen werden.",
                })
              }
              emptyMessage={t({
                en: "No help requests yet.",
                fr: "Aucune demande d'aide pour le moment.",
                de: "Noch keine Hilfeanfragen.",
              })}
              responsiveCards
              expandedRow={(request) => <PortalRequestDetails request={request} />}
            />
          </ListPageSection>
        </PortalTabPanel>
      ) : null}

      {requestDialog === "collaborator" ? (
        <Modal
          title={t({
            en: "Update project membership",
            fr: "Mettre à jour les membres du projet",
            de: "Projektmitglieder aktualisieren",
          })}
          onClose={closeRequestDialog}
        >
          <form className="grid gap-3" onSubmit={handleCollaboratorRequest}>
            <UiSelect
              label={t({ en: "Action", fr: "Action", de: "Aktion" })}
              value={collaboratorAction}
              onChange={(event) =>
                handleCollaboratorActionChange(
                  event.target.value as CollaboratorAction,
                )
              }
              disabled={
                requestsDisabled ||
                !canRequestManagedChanges ||
                busy === "collaborator"
              }
            >
              <option value="add">
                {t({ en: "Add", fr: "Ajouter", de: "Hinzufugen" })}
              </option>
              <option value="remove">
                {t({ en: "Remove", fr: "Retirer", de: "Entfernen" })}
              </option>
            </UiSelect>
            {collaboratorAction === "remove" ? (
              <UiSelect
                label={t({ en: "Email", fr: "Mail", de: "E-Mail" })}
                value={targetEmail}
                onChange={(event) =>
                  applyRemovalCollaborator(event.target.value)
                }
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "collaborator" ||
                  collaboratorsLoading ||
                  removableCollaborators.length === 0
                }
                required
              >
                <option value="">
                  {t({
                    en: "Select a collaborator",
                    fr: "Sélectionner un collaborateur",
                    de: "Mitwirkenden auswahlen",
                  })}
                </option>
                {removableCollaborators.map((collaborator) => (
                  <option key={collaborator.user_id} value={collaborator.email}>
                    {collaborator.display_name
                      ? `${collaborator.display_name} <${collaborator.email}>`
                      : collaborator.email}
                  </option>
                ))}
              </UiSelect>
            ) : (
              <UiInput
                label={t({ en: "Email", fr: "Mail", de: "E-Mail" })}
                type="email"
                value={targetEmail}
                onChange={(event) => setTargetEmail(event.target.value)}
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "collaborator"
                }
                required
              />
            )}
            <UiInput
              label={t({ en: "Name", fr: "Nom", de: "Name" })}
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              disabled={
                requestsDisabled ||
                !canRequestManagedChanges ||
                busy === "collaborator" ||
                collaboratorAction === "remove"
              }
              required
            />
            {collaboratorAction === "remove" &&
            !collaboratorsLoading &&
            removableCollaborators.length === 0 ? (
              <PageBanner tone="info">
                {t({
                  en: "No direct Portal collaborators can be removed from this project.",
                  fr: "Aucun collaborateur Portal direct ne peut être retiré de ce projet.",
                  de: "Keine direkten Portal-Mitwirkenden konnen aus diesem Projekt entfernt werden.",
                })}
              </PageBanner>
            ) : null}
            <label className="grid gap-1">
              <span className={uiLabelClass}>
                {t({
                  en: "Reason (optional)",
                  fr: "Motif (optionnel)",
                  de: "Grund (optional)",
                })}
              </span>
              <textarea
                className={cx(uiInputClass, "min-h-[72px] px-3 py-2 ui-body")}
                value={targetReason}
                onChange={(event) => setTargetReason(event.target.value)}
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "collaborator"
                }
              />
            </label>
            <div className="flex justify-end">
              <UiButton
                type="submit"
                size="sm"
                variant={
                  collaboratorAction === "remove" ? "danger" : undefined
                }
                disabled={collaboratorSubmitDisabled}
                loading={busy === "collaborator"}
              >
                {collaboratorAction === "remove"
                  ? t({
                      en: "Send removal request",
                      fr: "Envoyer la demande de retrait",
                      de: "Entfernungsanfrage senden",
                    })
                  : t({
                      en: "Send request",
                      fr: "Envoyer la demande",
                      de: "Anfrage senden",
                    })}
              </UiButton>
            </div>
          </form>
        </Modal>
      ) : null}

      {requestDialog === "storage-limit" ? (
        <Modal
          title={t({
            en: "Change project storage limit",
            fr: "Modifier la limite de stockage du projet",
            de: "Speichergrenze des Projekts ändern",
          })}
          onClose={closeRequestDialog}
          maxWidthClass="max-w-3xl"
        >
          <form className="grid gap-3" onSubmit={handleQuotaRequest}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_96px]">
              <UiSelect
                label={t({ en: "Change", fr: "Changement", de: "Änderung" })}
                value={quotaDirection}
                onChange={(event) =>
                  setQuotaDirection(event.target.value as PortalQuotaDirection)
                }
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "quota"
                }
              >
                <option value="increase">
                  {t({ en: "Raise", fr: "Augmenter", de: "Erhöhen" })}
                </option>
                <option value="decrease">
                  {t({ en: "Lower", fr: "Réduire", de: "Senken" })}
                </option>
              </UiSelect>
              <UiInput
                label={t({
                  en: "New limit",
                  fr: "Nouvelle limite",
                  de: "Neue Grenze",
                })}
                type="number"
                min="0"
                step="0.01"
                value={quotaValue}
                onChange={(event) => setQuotaValue(event.target.value)}
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "quota"
                }
                required
              />
              <UiSelect
                label={t({ en: "Unit", fr: "Unité", de: "Einheit" })}
                value={quotaUnit}
                onChange={(event) =>
                  setQuotaUnit(event.target.value as PortalQuotaUnit)
                }
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "quota"
                }
              >
                {quotaUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </UiSelect>
            </div>
            <QuotaChangePreview
              usedBytes={usedBytes}
              currentQuotaBytes={currentQuotaBytes}
              targetQuotaBytes={targetQuotaBytes}
              loading={usageLoading}
              belowUsed={quotaBelowUsed}
              directionMismatch={quotaDirectionMismatch}
              direction={quotaDirection}
            />
            {quotaBelowUsed ? (
              <PageBanner tone="error">
                {t({
                  en: "The new limit must stay above the space already used.",
                  fr: "La nouvelle limite doit rester au-dessus de l'espace déjà utilisé.",
                  de: "Die neue Grenze muss über der bereits genutzten Kapazität bleiben.",
                })}
              </PageBanner>
            ) : null}
            {!quotaBelowUsed && quotaDirectionMismatch ? (
              <PageBanner tone="warning">
                {quotaDirection === "increase"
                  ? t({
                      en: "The new limit is not higher than the current limit.",
                      fr: "La nouvelle limite n'est pas supérieure à la limite actuelle.",
                      de: "Die neue Grenze liegt nicht über der aktuellen Grenze.",
                    })
                  : t({
                      en: "The new limit is not lower than the current limit.",
                      fr: "La nouvelle limite n'est pas inférieure à la limite actuelle.",
                      de: "Die neue Grenze liegt nicht unter der aktuellen Grenze.",
                    })}
              </PageBanner>
            ) : null}
            <label className="grid gap-1">
              <span className={uiLabelClass}>
                {t({
                  en: "Reason (optional)",
                  fr: "Motif (optionnel)",
                  de: "Grund (optional)",
                })}
              </span>
              <textarea
                className={cx(uiInputClass, "min-h-[88px] px-3 py-2 ui-body")}
                value={quotaReason}
                onChange={(event) => setQuotaReason(event.target.value)}
                disabled={
                  requestsDisabled ||
                  !canRequestManagedChanges ||
                  busy === "quota"
                }
              />
            </label>
            <div className="flex justify-end">
              <UiButton
                type="submit"
                size="sm"
                disabled={quotaSubmitDisabled}
                loading={busy === "quota"}
              >
                {t({
                  en: "Send request",
                  fr: "Envoyer la demande",
                  de: "Anfrage senden",
                })}
              </UiButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </PageShell>
  );
}

function QuotaChangePreview({
  usedBytes,
  currentQuotaBytes,
  targetQuotaBytes,
  loading,
  belowUsed,
  directionMismatch,
  direction,
}: {
  usedBytes: number | null;
  currentQuotaBytes: number | null;
  targetQuotaBytes: number | null;
  loading: boolean;
  belowUsed: boolean;
  directionMismatch: boolean;
  direction: PortalQuotaDirection;
}) {
  const { t } = useI18n();
  const maxBytes = Math.max(
    usedBytes ?? 0,
    currentQuotaBytes ?? 0,
    targetQuotaBytes ?? 0,
    1,
  );
  const usedPct = clampPercent(((usedBytes ?? 0) / maxBytes) * 100);
  const currentPct =
    currentQuotaBytes == null
      ? null
      : clampPercent((currentQuotaBytes / maxBytes) * 100);
  const targetPct =
    targetQuotaBytes == null
      ? null
      : clampPercent((targetQuotaBytes / maxBytes) * 100);
  const targetTone =
    belowUsed || directionMismatch
      ? "bg-[var(--ui-danger)]"
      : "bg-[var(--ui-primary)]";
  const usedTone = belowUsed
    ? "bg-[var(--ui-danger)]"
    : "bg-[var(--ui-success)]";
  return (
    <div className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-surface-muted)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cx("ui-caption font-semibold", uiTitleTextClass)}>
          {t({
            en: "Storage limit preview",
            fr: "Prévisualisation de la limite",
            de: "Vorschau der Speichergrenze",
          })}
        </p>
        {loading ? (
          <p className={cx("ui-caption", uiMutedTextClass)}>
            {t({
              en: "Loading usage...",
              fr: "Chargement de l'usage...",
              de: "Nutzung wird geladen...",
            })}
          </p>
        ) : null}
      </div>
      <div
        className="relative mt-3 h-5 overflow-hidden rounded-full bg-[var(--ui-surface)] ring-1 ring-[var(--ui-border)]"
        aria-label={t({
          en: "Storage limit bar",
          fr: "Barre de limite",
          de: "Balken der Speichergrenze",
        })}
      >
        <div
          className={cx("h-full rounded-full transition-all", usedTone)}
          style={{ width: `${usedPct}%` }}
        />
        {currentPct != null ? (
          <div
            className="absolute inset-y-0 w-0.5 bg-[var(--ui-text)]/70"
            style={{ left: `${currentPct}%` }}
          />
        ) : null}
        {targetPct != null ? (
          <div
            className={cx("absolute inset-y-0 w-1 rounded-full", targetTone)}
            style={{ left: `${targetPct}%` }}
          />
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <QuotaLegendItem
          label={t({
            en: "Used now",
            fr: "Utilisé actuellement",
            de: "Aktuell genutzt",
          })}
          value={
            usedBytes == null
              ? t({
                  en: "Unavailable",
                  fr: "Indisponible",
                  de: "Nicht verfügbar",
                })
              : formatBytes(usedBytes)
          }
          swatchClassName={usedTone}
        />
        <QuotaLegendItem
          label={t({
            en: "Current limit",
            fr: "Limite actuelle",
            de: "Aktuelle Grenze",
          })}
          value={
            currentQuotaBytes == null
              ? t({ en: "No limit", fr: "Aucune limite", de: "Keine Grenze" })
              : formatBytes(currentQuotaBytes)
          }
          swatchClassName="bg-[var(--ui-text)]/70"
        />
        <QuotaLegendItem
          label={
            direction === "increase"
              ? t({
                  en: "Requested raise",
                  fr: "Augmentation demandée",
                  de: "Angeforderte Erhöhung",
                })
              : t({
                  en: "Requested reduction",
                  fr: "Réduction demandée",
                  de: "Angeforderte Senkung",
                })
          }
          value={
            targetQuotaBytes == null
              ? t({
                  en: "Enter a limit",
                  fr: "Saisir une limite",
                  de: "Grenze eingeben",
                })
              : formatBytes(targetQuotaBytes)
          }
          swatchClassName={targetTone}
        />
      </div>
    </div>
  );
}

function QuotaLegendItem({
  label,
  value,
  swatchClassName,
}: {
  label: string;
  value: string;
  swatchClassName: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          className={cx("h-2.5 w-2.5 rounded-full", swatchClassName)}
          aria-hidden="true"
        />
        <span className={uiLabelClass}>{label}</span>
      </div>
      <p className={cx("mt-1 truncate ui-body", uiTitleTextClass)}>{value}</p>
    </div>
  );
}

function PortalRequestDetails({ request }: { request: PortalAdminRequest }) {
  const { t } = useI18n();
  const reason = portalRequestReason(request);
  if (!reason && !request.error_message && request.messages.length === 0)
    return null;
  return (
    <div className="grid gap-3">
      {reason ? (
        <div>
          <p className={uiLabelClass}>
            {t({ en: "Reason", fr: "Motif", de: "Grund" })}
          </p>
          <p className="mt-1 ui-body">{reason}</p>
        </div>
      ) : null}
      {request.error_message ? (
        <PageBanner tone="error">{request.error_message}</PageBanner>
      ) : null}
      {request.messages.length > 0 ? (
        <div className={cx("border-t pt-3", uiDividerClass)}>
          <p className={uiLabelClass}>
            {t({ en: "Messages", fr: "Messages", de: "Nachrichten" })}
          </p>
          <div className="mt-2 grid gap-2">
            {request.messages.map((message) => (
              <div key={message.id} className="min-w-0">
                <p className="ui-caption font-semibold text-[var(--ui-text)]">
                  {message.author_email} ·{" "}
                  {formatPortalRequestDate(message.created_at)}
                </p>
                <p className={cx("mt-1 ui-body", uiMutedTextClass)}>
                  {message.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
