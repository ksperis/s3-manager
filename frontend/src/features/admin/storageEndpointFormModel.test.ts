import { describe, expect, it } from "vitest";
import {
  applyFeatureConstraints,
  awsCoordinatesForRegion,
  awsIamEndpointForRegion,
  awsS3EndpointForRegion,
  awsStsEndpointForRegion,
  buildFeaturesYaml,
  createEmptyForm,
  defaultFeaturesForProvider,
  normalizeAwsRegion,
  parseCoordinateInput,
} from "./storageEndpointFormModel";

describe("storage endpoint form model", () => {
  it("normalizes AWS regions and resolves partition endpoints", () => {
    expect(normalizeAwsRegion(" EU-West-3 ")).toBe("eu-west-3");
    expect(normalizeAwsRegion(" ")).toBe("us-east-1");
    expect(awsS3EndpointForRegion("eu-west-3")).toBe(
      "https://s3.eu-west-3.amazonaws.com",
    );
    expect(awsStsEndpointForRegion("cn-north-1")).toBe(
      "https://sts.cn-north-1.amazonaws.com.cn",
    );
    expect(awsIamEndpointForRegion("us-gov-west-1")).toBe(
      "https://iam.us-gov.amazonaws.com",
    );
    expect(awsIamEndpointForRegion("cn-northwest-1")).toBe(
      "https://iam.cn-north-1.amazonaws.com.cn",
    );
  });

  it("resolves known AWS coordinates without inventing unknown locations", () => {
    expect(awsCoordinatesForRegion("eu-west-3")).toEqual({
      latitude: "48.8566",
      longitude: "2.3522",
    });
    expect(awsCoordinatesForRegion("future-region-1")).toBeNull();
  });

  it("applies provider constraints without mutating the source features", () => {
    const source = defaultFeaturesForProvider("aws", "eu-west-3");
    source.admin.enabled = true;
    source.account.enabled = true;
    source.replication.enabled = true;
    source.healthcheck.mode = "s3";

    const constrained = applyFeatureConstraints(source, "aws");

    expect(constrained.admin.enabled).toBe(false);
    expect(constrained.account.enabled).toBe(false);
    expect(constrained.replication.enabled).toBe(false);
    expect(constrained.healthcheck.mode).toBe("http");
    expect(source.admin.enabled).toBe(true);
    expect(source.healthcheck.mode).toBe("s3");
  });

  it("serializes enabled endpoint overrides and healthcheck settings", () => {
    const features = defaultFeaturesForProvider("aws", "eu-west-3");
    features.healthcheck.endpoint = " https://health.example.test/status ";

    const yaml = buildFeaturesYaml(features);

    expect(yaml).toContain(
      "sts:\n    enabled: true\n    endpoint: https://sts.eu-west-3.amazonaws.com",
    );
    expect(yaml).toContain(
      "iam:\n    enabled: true\n    endpoint: https://iam.amazonaws.com",
    );
    expect(yaml).toContain(
      "healthcheck:\n    enabled: true\n    mode: http\n    healthcheck_url: https://health.example.test/status",
    );
  });

  it("validates optional coordinate inputs", () => {
    expect(parseCoordinateInput("", "Latitude", -90, 90)).toBeNull();
    expect(parseCoordinateInput(" 48.8566 ", "Latitude", -90, 90)).toBe(
      48.8566,
    );
    expect(() => parseCoordinateInput("91", "Latitude", -90, 90)).toThrow(
      "Latitude must be a number between -90 and 90.",
    );
  });

  it("creates isolated default form state", () => {
    const first = createEmptyForm();
    const second = createEmptyForm();

    first.features.iam.enabled = false;

    expect(first.provider).toBe("ceph");
    expect(first.verify_tls).toBe(true);
    expect(second.features.iam.enabled).toBe(true);
  });
});
