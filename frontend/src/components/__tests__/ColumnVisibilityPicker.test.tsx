import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import ColumnVisibilityPicker, { type ColumnPickerExpandableGroup, type ColumnPickerGroup } from "../ColumnVisibilityPicker";

type ColumnId = "owner" | "tags" | "versioning" | "lifecycle_rules" | "lifecycle_expiration_days";

function PickerHarness() {
  const [checked, setChecked] = useState<Record<ColumnId, boolean>>({
    owner: true,
    tags: false,
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
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Versioning")).toBeInTheDocument();
    expect(screen.queryByLabelText("Lifecycle expiration days")).not.toBeInTheDocument();
  });

  it("toggles a main column and updates the selected counter", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByLabelText("S3 Tags"));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("opens details and toggles a detail column", async () => {
    const user = userEvent.setup();
    render(<PickerHarness />);

    await user.click(screen.getByRole("button", { name: "Details ▸" }));
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
