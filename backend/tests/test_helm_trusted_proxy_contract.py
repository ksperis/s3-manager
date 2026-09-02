# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pathlib import Path

import yaml


def test_helm_requires_and_serializes_structured_trusted_proxy_cidrs():
    repository_root = Path(__file__).resolve().parents[2]
    values = yaml.safe_load(
        repository_root.joinpath("helm/bucketreef/values.yaml").read_text(encoding="utf-8")
    )
    template = repository_root.joinpath(
        "helm/bucketreef/templates/backend-deployment.yaml"
    ).read_text(encoding="utf-8")

    assert values["backend"]["trustedProxyCidrs"] == []
    assert "backend.trustedProxyCidrs is required" in template
    assert 'hasKey .Values.backend.env "TRUSTED_PROXY_CIDRS"' in template
    assert "name: TRUSTED_PROXY_CIDRS" in template
    assert ".Values.backend.trustedProxyCidrs | toJson" in template


def test_ci_covers_positive_and_negative_trusted_proxy_rendering():
    repository_root = Path(__file__).resolve().parents[2]
    pipeline = repository_root.joinpath(".gitlab-ci.yml").read_text(encoding="utf-8")

    assert "expected missing trusted proxy CIDRs to fail" in pipeline
    assert pipeline.count("backend.trustedProxyCidrs") >= 5
    assert "name: TRUSTED_PROXY_CIDRS" in pipeline
