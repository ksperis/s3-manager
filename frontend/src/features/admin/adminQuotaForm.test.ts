import { buildAdminQuotaSizeEditorValue } from "./adminQuotaForm";

describe("buildAdminQuotaSizeEditorValue", () => {
  it("keeps missing and whole GiB quota values in GiB", () => {
    expect(buildAdminQuotaSizeEditorValue()).toEqual({ value: "", unit: "GiB" });
    expect(buildAdminQuotaSizeEditorValue(null)).toEqual({ value: "", unit: "GiB" });
    expect(buildAdminQuotaSizeEditorValue(4)).toEqual({ value: "4", unit: "GiB" });
  });

  it("presents fractional GiB quota values as MiB", () => {
    expect(buildAdminQuotaSizeEditorValue(0.5)).toEqual({ value: "512", unit: "MiB" });
  });
});
