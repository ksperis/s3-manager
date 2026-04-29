import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import ColumnVisibilityPicker, {
  type ColumnPickerDetailGroup,
  type ColumnPickerExpandableGroup,
  type ColumnPickerGroup,
} from "../ColumnVisibilityPicker";

type ColumnId = "owner" | "tags" | "quota_max_size_bytes" | "versioning" | "lifecycle_rules" | "lifecycle_expiration_days";

function PickerHarness() {
  const [checked, setChecked] = useState<Record<ColumnId, boolean>>({
    owner: true,
    tags: false,
    quota_max_size_bytes: false,
    versioning: false,
    lifecycle_rules: true,
    lifecycle_expiration_days: false,
  });

  const selectedCount = useMemo(() => Object.values(checked).filter(Boolean).length, [checked]);
  const toggle = (id: ColumnId) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  const reset = () =>
    setChecked({
      owner: true,
      tags: false,
      quota_max_size_bytes: false,
      versioning: false,
      lifecycle_rules: true,
      lifecycle_expiration_days: false,
    });

  const coreGroups: Array<ColumnPickerGroup<ColumnId>> = [
    {
      id: "core",
      label: "Core",
      options: [
        { id: "owner", label: "Owner", checked: checked.owner, onToggle: () => toggle("owner") },
        { id: "tags", label: "S3 Tags", checked: checked.tags, onToggle: () => toggle("tags") },
      ],
    },
  ];

  const detailGroups: Array<ColumnPickerDetailGroup<ColumnId>> = [
    {
      id: "bucket_quota",
      label: "Bucket quota",
      details: [
        {
          id: "quota_max_size_bytes",
          label: "Quota",
          checked: checked.quota_max_size_bytes,
          onToggle: () => toggle("quota_max_size_bytes"),
        },
      ],
    },
  ];

  const featureGroups: Array<ColumnPickerExpandableGroup<ColumnId>> = [
    {
      id: "versioning",
      label: "Versioning",
      checked: checked.versioning,
      onToggle: () => toggle("versioning"),
    },
    {
      id: "lifecycle_rules",
      label: "Lifecycle rules",
      checked: checked.lifecycle_rules,
      onToggle: () => toggle("lifecycle_rules"),
      details: [
        {
          id: "lifecycle_expiration_days",
          label: "Lifecycle expiration days",
          checked: checked.lifecycle_expiration_days,
          onToggle: () => toggle("lifecycle_expiration_days"),
        },
      ],
    },
  ];

  return (
    <ColumnVisibilityPicker
      selectedCount={selectedCount}
      onReset={reset}
      coreGroups={coreGroups}
      detailGroups={detailGroups}
      featureGroups={featureGroups}
      footerNote="Feature checks run only on enabled columns."
    />
  );
}

describe("ColumnVisibilityPicker", () => {
  it("renders sections and starts with details collapsed", () => {
    render(<PickerHarness />);

    expect(screen.getByText("Visible columns")).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Versioning")).toBeInTheDocument();
    expect(screen.getByText("Bucket quota")).toBeInTheDocument();
    expect(screen.queryByLabelText("Quota")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Lifecycle expiration days")).not.toBeInTheDocument();
  });

  it("toggles a main column and updates the selected counter", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByLabelText("S3 Tags"));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("opens standalone detail groups without a parent checkbox", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    expect(screen.queryByLabelText("Bucket quota")).not.toBeInTheDocument();
    const bucketQuotaGroup = screen.getByText("Bucket quota").closest("div");
    expect(bucketQuotaGroup).not.toBeNull();
    await user.click(within(bucketQuotaGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));

    expect(screen.getByLabelText("Quota")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Quota"));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("opens details and toggles a detail column", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    const lifecycleGroup = screen.getByText("Lifecycle rules").closest("div");
    expect(lifecycleGroup).not.toBeNull();
    await user.click(within(lifecycleGroup as HTMLElement).getByRole("button", { name: "Details ▸" }));
    expect(screen.getByLabelText("Lifecycle expiration days")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Lifecycle expiration days"));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("calls reset action", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const coreGroups: Array<ColumnPickerGroup<ColumnId>> = [
      { id: "core", label: "Core", options: [{ id: "owner", label: "Owner", checked: false, onToggle: () => undefined }] },
    ];
    render(<ColumnVisibilityPicker selectedCount={0} onReset={onReset} coreGroups={coreGroups} />);

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
