export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type LocalStorageSeed = {
  token: string;
  user: Record<string, unknown>;
  selectedWorkspace?: "admin" | "manager" | "browser" | "ceph-admin" | "storage-ops";
  selectedExecutionContextId?: string;
  selectedCephAdminEndpointId?: string;
  theme?: "light" | "dark";
  extraEntries?: Record<string, string>;
};

export type MockRule = {
  id: string;
  method?: HttpMethod;
  path: RegExp;
  status?: number;
  delayMs?: number;
  body:
    | unknown
    | ((ctx: {
        url: URL;
        method: string;
        requestBodyText: string;
      }) => unknown);
};

export type ScenarioAction =
  | { type: "click"; selector: string }
  | { type: "wait"; selector: string }
  | { type: "select"; selector: string; value: string }
  | { type: "press"; selector: string; key: string };

export type DocScreenshotScenario = {
  id: string;
  docPage: string;
  route: string;
  outputFile: string;
  waitFor: string;
  storage: LocalStorageSeed;
  actions?: ScenarioAction[];
  mockRules: MockRule[];
  postScreenshotWaitMs?: number;
  postScreenshotActions?: ScenarioAction[];
};
