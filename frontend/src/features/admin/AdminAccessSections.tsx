import type { ManagerToolAccess } from "../../api/users";
import {
  PortalSettingsItem,
  PortalSettingsSection,
  PortalSettingsToggleAction,
} from "../../components/PortalSettingsLayout";
import {
  type ManagerToolDefinition,
  type ManagerToolKey,
  normalizeManagerToolAccess,
} from "./adminAccessConfig";

export const adminModalSettingsGroupClass =
  "rounded-lg border border-[color:var(--ui-border)] bg-[var(--ui-surface-muted)] p-4";

export const adminSettingsItemSurfaceClass = (disabled: boolean) =>
  disabled ? "bg-[var(--ui-surface-muted)] opacity-75" : "bg-[var(--ui-surface)]";

export type WorkspaceAccessToggle = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  ariaLabel: string;
  onChange: (value: boolean) => void;
};

export function AdminAccessToggleSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: WorkspaceAccessToggle[];
}) {
  return (
    <div className={adminModalSettingsGroupClass}>
      <PortalSettingsSection title={title} description={description} layout="stack">
        {items.map((item) => {
          const disabled = Boolean(item.disabled);
          return (
            <PortalSettingsItem
              key={item.ariaLabel}
              title={item.title}
              description={item.description}
              className={adminSettingsItemSurfaceClass(disabled)}
              action={
                <PortalSettingsToggleAction
                  checked={item.checked}
                  disabled={disabled}
                  onChange={item.onChange}
                  ariaLabel={item.ariaLabel}
                />
              }
            />
          );
        })}
      </PortalSettingsSection>
    </div>
  );
}

export function WorkspaceAccessSection({
  description,
  cephAdmin,
  storageOps,
}: {
  description: string;
  cephAdmin: WorkspaceAccessToggle;
  storageOps: WorkspaceAccessToggle;
}) {
  return (
    <AdminAccessToggleSection
      title="Mass management workspaces"
      description={description}
      items={[cephAdmin, storageOps]}
    />
  );
}

export function BrowserAccessSection({
  checked,
  onChange,
  description = "Configure Browser features for this admin subject.",
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}) {
  return (
    <div className={adminModalSettingsGroupClass}>
      <PortalSettingsSection title="Browser" description={description} layout="stack">
        <PortalSettingsItem
          title="Advanced Browser actions and Workbench"
          description="Allows technical S3 actions and access to the optional Workbench layout. When disabled, /browser uses the simpler Standard profile."
          className={adminSettingsItemSurfaceClass(false)}
          action={
            <PortalSettingsToggleAction
              checked={checked}
              onChange={onChange}
              ariaLabel="Enable advanced Browser features"
            />
          }
        />
      </PortalSettingsSection>
    </div>
  );
}

export function ManagerToolAccessSection({
  title,
  description,
  tools,
  access,
  onChange,
  isToolDisabled,
}: {
  title: string;
  description: string;
  tools: ManagerToolDefinition[];
  access?: ManagerToolAccess | null;
  onChange: (key: ManagerToolKey, value: boolean) => void;
  isToolDisabled?: (tool: ManagerToolDefinition) => boolean;
}) {
  const normalizedAccess = normalizeManagerToolAccess(access);
  return (
    <div className={adminModalSettingsGroupClass}>
      <PortalSettingsSection title={title} description={description} layout="stack">
        {tools.map((tool) => {
          const disabled = isToolDisabled ? isToolDisabled(tool) : !tool.enabled;
          return (
            <PortalSettingsItem
              key={tool.key}
              title={tool.title}
              description={tool.description}
              className={adminSettingsItemSurfaceClass(disabled)}
              action={
                <PortalSettingsToggleAction
                  checked={Boolean(normalizedAccess[tool.key])}
                  disabled={disabled}
                  onChange={(value) => onChange(tool.key, value)}
                  ariaLabel={tool.title}
                  badge={{ visible: !tool.enabled, label: "Disabled globally", tone: "neutral" }}
                />
              }
            />
          );
        })}
      </PortalSettingsSection>
    </div>
  );
}
