# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _read(path: str) -> str:
    return ROOT.joinpath(path).read_text(encoding="utf-8")


def test_runtime_images_are_fixed_non_root_and_read_only_compatible():
    backend = _read("backend/Dockerfile")
    frontend = _read("frontend/Dockerfile")
    nginx = _read("frontend/nginx.conf.template")
    scheduler = _read("scheduler/Dockerfile")
    scheduler_entrypoint = _read("scheduler/entrypoint.sh")

    assert "USER 10001:10001" in backend
    assert "USER 101:101" in frontend
    assert "listen 8080;" in nginx
    assert all(path in nginx for path in ("pid /tmp/nginx.pid", "client_body_temp_path /tmp/"))
    assert "SUPERCRONIC_VERSION=v0.2.49" in scheduler
    assert "sha256sum -c" in scheduler
    assert "USER 10001:10001" in scheduler
    assert "apk add" not in scheduler_entrypoint
    assert "NOTIFICATION_RETENTION_CRON_SCHEDULE" in scheduler_entrypoint
    assert "run-notification-retention.sh" in scheduler_entrypoint
    assert "exec supercronic" in scheduler_entrypoint


def test_compose_services_drop_privileges_and_keep_public_port():
    for filename in ("docker-compose.yml", "docker-compose.build.yml"):
        compose = yaml.safe_load(_read(filename))
        services = compose["services"]
        for name in ("backend", "frontend", "scheduler"):
            service = services[name]
            assert service["read_only"] is True
            assert service["cap_drop"] == ["ALL"]
            assert service["security_opt"] == ["no-new-privileges:true"]
            assert service["tmpfs"]
        assert services["frontend"]["ports"][0].endswith(":8080")
        assert services["scheduler"]["user"] == "10001:10001"
        assert services["backend"]["environment"][
            "USER_NOTIFICATIONS_RETENTION_DAYS"
        ]
        assert services["scheduler"]["environment"][
            "NOTIFICATION_RETENTION_CRON_SCHEDULE"
        ]


def test_helm_workloads_apply_least_privilege_contract():
    templates = [
        "backend-deployment.yaml",
        "frontend-deployment.yaml",
        "postgresql-deployment.yaml",
        "billing-cronjob.yaml",
        "healthcheck-cronjob.yaml",
        "quota-monitor-cronjob.yaml",
        "usage-history-cronjob.yaml",
        "notification-retention-cronjob.yaml",
    ]
    for filename in templates:
        template = _read(f"helm/bucketreef/templates/{filename}")
        assert "automountServiceAccountToken: false" in template
        assert "securityContext:" in template
        assert "resources:" in template
        assert "mountPath: /tmp" in template

    values = yaml.safe_load(_read("helm/bucketreef/values.yaml"))
    for section in ("backend", "frontend", "postgresql"):
        assert values[section]["podSecurityContext"]["runAsNonRoot"] is True
        assert values[section]["podSecurityContext"]["seccompProfile"]["type"] == "RuntimeDefault"
        container = values[section]["containerSecurityContext"]
        assert container["allowPrivilegeEscalation"] is False
        assert container["readOnlyRootFilesystem"] is True
        assert container["capabilities"]["drop"] == ["ALL"]


def test_strict_network_policies_are_fail_closed_and_cover_all_workloads():
    values = yaml.safe_load(_read("helm/bucketreef/values.yaml"))
    network = values["networkPolicy"]
    assert network["strict"] is True
    assert network["publicHttpsEgress"] == []
    assert network["privateEgress"] == []

    template = _read("helm/bucketreef/templates/networkpolicies.yaml")
    for component in ("frontend", "backend", "cronjobs", "postgresql"):
        assert f'}}-{component}' in template
    assert "publicHttpsEgress is required" in template
    assert "port: 443" in template
    assert "port: 53" in template
    assert "metadata exclusions explicitly" in template


def test_ci_builds_scans_and_promotes_scheduler_image():
    pipeline = _read(".gitlab-ci.yml")
    for job in (
        "build-scheduler:",
        "scheduler-image-vuln-scan:",
        "scheduler-release-image-vuln-scan:",
        "promote-scheduler-release:",
    ):
        assert job in pipeline
    assert "scheduler-image-sbom.cdx.json" in pipeline
