import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import S3CredentialsValidationMessage from "./S3CredentialsValidationMessage";

describe("S3CredentialsValidationMessage", () => {
  it("renders loading state with the shared info treatment", () => {
    render(<S3CredentialsValidationMessage validation={{ status: "loading", result: null }} />);

    const message = screen.getByText("Validating credentials...");
    expect(message).toHaveClass("border-sky-200");
    expect(message).toHaveClass("ui-caption");
  });

  it("maps validation severities to shared inline message tones", () => {
    const { rerender } = render(
      <S3CredentialsValidationMessage
        validation={{
          status: "done",
          result: { ok: false, severity: "warning", message: "Credentials work, but bucket listing is limited." },
        }}
      />
    );

    expect(screen.getByText("Credentials work, but bucket listing is limited.")).toHaveClass("border-amber-200");

    rerender(
      <S3CredentialsValidationMessage
        validation={{
          status: "done",
          result: { ok: false, severity: "error", message: "Invalid S3 credentials." },
        }}
      />
    );

    expect(screen.getByText("Invalid S3 credentials.")).toHaveClass("border-rose-200");
  });

  it("renders nothing while idle", () => {
    const { container } = render(<S3CredentialsValidationMessage validation={{ status: "idle", result: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
