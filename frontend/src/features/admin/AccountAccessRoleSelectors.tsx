import type { ReactNode } from "react";
import {
  MANAGER_ACCOUNT_ROLE_OPTIONS,
  PORTAL_ACCOUNT_ROLE_OPTIONS,
  getAccountAccessRequiredMessage,
  hasAccountAccessRole,
  parseManagerAccountRole,
  parsePortalAccountRole,
  type AccountAccessGrant,
} from "../../api/accountAccess";
import UiSelect from "../../components/ui/UiSelect";

type AccountRoleSelectProps = {
  value: AccountAccessGrant;
  onChange: (value: AccountAccessGrant) => void;
  label: string;
  showLabel?: boolean;
  fieldClassName?: string;
  invalid?: boolean;
  describedBy?: string;
};

type ManagerAccountRoleSelectProps = AccountRoleSelectProps & {
  error?: ReactNode;
};

export function ManagerAccountRoleSelect({
  value,
  onChange,
  label,
  showLabel = true,
  fieldClassName = "w-52",
  invalid = false,
  describedBy,
  error,
}: ManagerAccountRoleSelectProps) {
  return (
    <UiSelect
      label={showLabel ? "Manager" : undefined}
      error={error}
      aria-label={`Manager role for ${label}`}
      {...(invalid ? { "aria-invalid": true } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      size="compact"
      fieldClassName={fieldClassName}
      value={value.manager_role ?? ""}
      onChange={(event) => {
        const managerRole = parseManagerAccountRole(event.target.value);
        onChange({
          ...value,
          manager_role: managerRole,
          allow_manager_browser_data_access:
            managerRole === null ? false : value.allow_manager_browser_data_access,
        });
      }}
    >
      {MANAGER_ACCOUNT_ROLE_OPTIONS.map((option) => (
        <option key={option.value || "none"} value={option.value}>
          {option.label}
        </option>
      ))}
    </UiSelect>
  );
}

type PortalAccountRoleSelectProps = AccountRoleSelectProps & {
  portalEnabled: boolean;
};

export function PortalAccountRoleSelect({
  value,
  onChange,
  portalEnabled,
  label,
  showLabel = true,
  fieldClassName = "w-44",
  invalid = false,
  describedBy,
}: PortalAccountRoleSelectProps) {
  return (
    <UiSelect
      label={showLabel ? (portalEnabled ? "Portal" : "Portal · read-only") : undefined}
      hint={showLabel && !portalEnabled ? "Portal is off; existing roles are preserved." : undefined}
      aria-label={`Portal role for ${label}`}
      {...(invalid ? { "aria-invalid": true } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      title={!portalEnabled ? "Portal is off; existing roles are preserved." : undefined}
      size="compact"
      fieldClassName={fieldClassName}
      value={value.portal_role ?? ""}
      disabled={!portalEnabled}
      onChange={(event) =>
        onChange({
          ...value,
          portal_role: parsePortalAccountRole(event.target.value),
        })
      }
    >
      {PORTAL_ACCOUNT_ROLE_OPTIONS.map((option) => (
        <option key={option.value || "none"} value={option.value}>
          {option.label}
        </option>
      ))}
    </UiSelect>
  );
}

type AccountAccessRoleValidationMessageProps = {
  id: string;
  value: AccountAccessGrant;
  portalEnabled: boolean;
};

export function AccountAccessRoleValidationMessage({
  id,
  value,
  portalEnabled,
}: AccountAccessRoleValidationMessageProps) {
  if (hasAccountAccessRole(value)) return null;

  return (
    <p id={id} role="alert" className="mt-1 max-w-56 ui-caption font-semibold text-rose-600 dark:text-rose-300">
      {getAccountAccessRequiredMessage(portalEnabled)}
    </p>
  );
}

type AccountAccessRoleSelectorsProps = {
  value: AccountAccessGrant;
  onChange: (value: AccountAccessGrant) => void;
  portalEnabled: boolean;
  label: string;
};

export default function AccountAccessRoleSelectors({
  value,
  onChange,
  portalEnabled,
  label,
}: AccountAccessRoleSelectorsProps) {
  const missingRole = !hasAccountAccessRole(value);

  return (
    <div className="flex flex-wrap items-start gap-3">
      <ManagerAccountRoleSelect
        label={label}
        value={value}
        onChange={onChange}
        error={missingRole ? getAccountAccessRequiredMessage(portalEnabled) : undefined}
      />
      <PortalAccountRoleSelect
        label={label}
        portalEnabled={portalEnabled}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
