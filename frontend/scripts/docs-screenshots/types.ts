export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AnnotationSide = "top" | "right" | "bottom" | "left";

export type AnnotationTarget = {
  selector: string;
  label: string;
  side?: AnnotationSide;
  offsetX?: number;
  offsetY?: number;
};

export type LocalStorageSeed = {
  token: string;
  user: Record<string, unknown>;
  selectedWorkspace?: "admin" | "manager" | "browser" | "portal" | "ceph-admin";
  selectedExecutionContextId?: string;
  selectedPortalAccountId?: string;
  selectedCephAdminEndpointId?: string;
  theme?: "light" | "dark";
};

export type MockRule = {
  id: string;
  method?: HttpMethod;
  path: RegExp;
  status?: number;
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
  | { type: "press"; selector: string; key: string };

export type DocScreenshotScenario = {
  id: string;
  docPage: string;
  route: string;
  outputFile: string;
  waitFor: string;
  storage: LocalStorageSeed;
  actions?: ScenarioAction[];
  annotations: AnnotationTarget[];
  mockRules: MockRule[];
};
