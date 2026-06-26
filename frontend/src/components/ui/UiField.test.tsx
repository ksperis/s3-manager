import { render, screen } from "@testing-library/react";

import UiField from "./UiField";
import UiSelect from "./UiSelect";
import UiTextarea from "./UiTextarea";

describe("UiField", () => {
  it("wires labels, hints, and errors to custom controls", () => {
    render(
      <UiField label="Endpoint" hint="Use the public S3 endpoint." error="Endpoint is required">
        {({ id, describedBy, invalid }) => (
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </UiField>
    );

    const input = screen.getByLabelText("Endpoint");
    expect(input).toHaveAccessibleDescription("Use the public S3 endpoint. Endpoint is required");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("renders standard select and textarea controls with shared ui-control styling", () => {
    render(
      <>
        <UiSelect label="Provider" defaultValue="ceph">
          <option value="ceph">Ceph</option>
        </UiSelect>
        <UiTextarea label="Policy" defaultValue="{}" />
      </>
    );

    expect(screen.getByLabelText("Provider")).toHaveClass("ui-control");
    expect(screen.getByLabelText("Policy")).toHaveClass("ui-control");
  });
});
