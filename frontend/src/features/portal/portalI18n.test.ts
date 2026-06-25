import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";

describe("portal i18n helpers", () => {
  it("translates the requested locale and falls back deterministically", () => {
    expect(translate({ en: "Storage Spaces", fr: "Espaces de stockage", de: "Speicherbereiche" }, "fr")).toBe("Espaces de stockage");
    expect(translate({ fr: "Partages", de: "Freigaben" }, "en")).toBe("Partages");
    expect(translate("Portal", "de")).toBe("Portal");
  });
});
