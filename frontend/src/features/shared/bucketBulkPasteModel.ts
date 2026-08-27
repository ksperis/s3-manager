/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type {
  BulkConfigClipboard,
  BulkPastePlan,
  BulkPastePlanItem,
} from "./bucketBulkOperationsModel";
import {
  areStringMapEqual,
  formatBucketNamesPreview,
  normalizeBucketName,
} from "./bucketOpsPresentation";

type BuildBulkPastePlanOptions = {
  clipboard: BulkConfigClipboard | null;
  destinationBucketNames: string[];
  mapping: Record<string, string>;
  missingScopeHint: string;
  selectedEndpointId: number | null;
};

type ReconcileBulkPasteMappingOptions = {
  destinationBucketNames: string[];
  previousMapping: Record<string, string>;
  sameEndpoint: boolean;
  sourceBucketNames: string[];
};

export function isBulkClipboardSameEndpoint(
  clipboard: BulkConfigClipboard | null,
  selectedEndpointId: number | null
): boolean {
  return Boolean(
    clipboard &&
      selectedEndpointId &&
      clipboard.sourceEndpointId === selectedEndpointId
  );
}

export function buildBulkPastePlan({
  clipboard,
  destinationBucketNames,
  mapping,
  missingScopeHint,
  selectedEndpointId,
}: BuildBulkPastePlanOptions): BulkPastePlan {
  if (!clipboard) {
    return { mode: null, mappings: [], error: "No copied configuration available." };
  }
  if (!selectedEndpointId) {
    return { mode: null, mappings: [], error: missingScopeHint };
  }
  if (!Object.values(clipboard.features).some(Boolean)) {
    return {
      mode: null,
      mappings: [],
      error: "Clipboard does not include any copied configuration.",
    };
  }

  const sourceBuckets = clipboard.buckets;
  if (sourceBuckets.length === 0) {
    return { mode: null, mappings: [], error: "Copied selection is empty." };
  }
  if (destinationBucketNames.length === 0) {
    return { mode: null, mappings: [], error: "Select destination buckets first." };
  }

  const sameEndpoint = isBulkClipboardSameEndpoint(clipboard, selectedEndpointId);
  if (sourceBuckets.length === 1) {
    const source = sourceBuckets[0];
    if (sameEndpoint) {
      const conflictingDestinations = destinationBucketNames.filter(
        (destination) =>
          normalizeBucketName(destination) === normalizeBucketName(source.name)
      );
      if (conflictingDestinations.length > 0) {
        return {
          mode: "one_to_many",
          mappings: [],
          error: `Copy/paste on the same bucket is not allowed: ${formatBucketNamesPreview(conflictingDestinations)}.`,
        };
      }
    }
    return {
      mode: "one_to_many",
      mappings: destinationBucketNames.map((destinationBucket) => ({
        sourceBucket: source.name,
        destinationBucket,
        sourceConfig: source,
      })),
      error: null,
    };
  }

  if (sourceBuckets.length !== destinationBucketNames.length) {
    return {
      mode: null,
      mappings: [],
      error: `Mapping impossible: source has ${sourceBuckets.length} bucket(s), destination has ${destinationBucketNames.length}.`,
    };
  }

  const destinationByNormalized = new Map<string, string>();
  destinationBucketNames.forEach((destination) => {
    destinationByNormalized.set(normalizeBucketName(destination), destination);
  });
  const usedDestinations = new Set<string>();
  const unresolvedSources: string[] = [];
  const duplicateDestinations: string[] = [];
  const invalidDestinations: string[] = [];
  const sameBucketConflicts: string[] = [];
  const mappings: BulkPastePlanItem[] = [];

  sourceBuckets.forEach((source) => {
    const selectedDestination = (mapping[source.name] ?? "").trim();
    if (!selectedDestination) {
      unresolvedSources.push(source.name);
      return;
    }
    const normalizedDestination = normalizeBucketName(selectedDestination);
    const destinationBucket = destinationByNormalized.get(normalizedDestination);
    if (!destinationBucket) {
      invalidDestinations.push(selectedDestination);
      return;
    }
    if (sameEndpoint && normalizedDestination === normalizeBucketName(source.name)) {
      sameBucketConflicts.push(source.name);
      return;
    }
    if (usedDestinations.has(normalizedDestination)) {
      duplicateDestinations.push(destinationBucket);
      return;
    }
    usedDestinations.add(normalizedDestination);
    mappings.push({
      sourceBucket: source.name,
      destinationBucket,
      sourceConfig: source,
    });
  });

  if (unresolvedSources.length > 0) {
    return {
      mode: "one_to_one",
      mappings: [],
      error: `Complete the mapping for all source buckets (${unresolvedSources.length} missing).`,
    };
  }
  if (invalidDestinations.length > 0) {
    return {
      mode: "one_to_one",
      mappings: [],
      error: `Some mapped destinations are invalid: ${formatBucketNamesPreview(invalidDestinations)}.`,
    };
  }
  if (sameBucketConflicts.length > 0) {
    return {
      mode: "one_to_one",
      mappings: [],
      error: `Copy/paste on the same bucket is not allowed: ${formatBucketNamesPreview(sameBucketConflicts)}.`,
    };
  }
  if (duplicateDestinations.length > 0) {
    return {
      mode: "one_to_one",
      mappings: [],
      error: "Each destination bucket can only be used once in 1:1 mapping.",
    };
  }

  return { mode: "one_to_one", mappings, error: null };
}

export function reconcileBulkPasteMapping({
  destinationBucketNames,
  previousMapping,
  sameEndpoint,
  sourceBucketNames,
}: ReconcileBulkPasteMappingOptions): Record<string, string> {
  if (
    sourceBucketNames.length <= 1 ||
    sourceBucketNames.length !== destinationBucketNames.length
  ) {
    return Object.keys(previousMapping).length === 0 ? previousMapping : {};
  }

  const destinationByNormalized = new Map<string, string>();
  destinationBucketNames.forEach((destination) => {
    destinationByNormalized.set(normalizeBucketName(destination), destination);
  });
  const next: Record<string, string> = {};
  const usedDestinations = new Set<string>();

  sourceBucketNames.forEach((sourceBucket) => {
    const previousValue = (previousMapping[sourceBucket] ?? "").trim();
    if (!previousValue) return;
    const normalizedDestination = normalizeBucketName(previousValue);
    const destination = destinationByNormalized.get(normalizedDestination);
    if (!destination) return;
    if (
      sameEndpoint &&
      normalizedDestination === normalizeBucketName(sourceBucket)
    ) {
      return;
    }
    if (usedDestinations.has(normalizedDestination)) return;
    next[sourceBucket] = destination;
    usedDestinations.add(normalizedDestination);
  });

  if (!sameEndpoint) {
    sourceBucketNames.forEach((sourceBucket) => {
      if (next[sourceBucket]) return;
      const normalizedSource = normalizeBucketName(sourceBucket);
      const destination = destinationByNormalized.get(normalizedSource);
      if (!destination || usedDestinations.has(normalizedSource)) return;
      next[sourceBucket] = destination;
      usedDestinations.add(normalizedSource);
    });
  }

  return areStringMapEqual(previousMapping, next) ? previousMapping : next;
}
