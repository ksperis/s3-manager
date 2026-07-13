import { render, screen } from "@testing-library/react";

import PageBanner from "../PageBanner";

describe("PageBanner", () => {
  it("wraps long technical messages within the available width", () => {
    render(
      <PageBanner tone="error">
        RGW admin error 404:
        {" "}
        {"{\"Code\":\"NoSuchKey\",\"RequestId\":\"tx00000a5ea4fd25c964013-006a4cc0d7-35b05752-s3-tls\"}"}
      </PageBanner>
    );

    const banner = screen.getByText(/RGW admin error 404/);
    expect(banner).toHaveClass("min-w-0", "max-w-full", "break-words", "[overflow-wrap:anywhere]");
    expect(banner).toHaveAttribute("role", "alert");
  });
});
