# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.db import Project, ProjectS3Account, S3Account, StorageEndpoint, StorageProvider
from app.services.admin_metrics_service import AdminMetricsService


def _seed_endpoint(db_session, *, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=StorageProvider.CEPH.value,
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.flush()
    return endpoint


def _seed_account(db_session, *, name: str, endpoint: StorageEndpoint) -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=f"rgw-{name}",
        rgw_access_key=f"AK-{name}",
        rgw_secret_key="SECRET",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.flush()
    return account


def test_admin_summary_counts_projects_and_project_account_links(db_session):
    first_endpoint = _seed_endpoint(db_session, name="paris")
    second_endpoint = _seed_endpoint(db_session, name="rennes")
    first = _seed_account(db_session, name="first", endpoint=first_endpoint)
    replica = _seed_account(db_session, name="replica", endpoint=first_endpoint)
    remote = _seed_account(db_session, name="remote", endpoint=second_endpoint)
    genome = Project(name="Genome", description="Sequencing")
    climate = Project(name="Climate", description=None)
    empty = Project(name="Empty", description=None)
    db_session.add_all([genome, climate, empty])
    db_session.flush()
    db_session.add_all(
        [
            ProjectS3Account(project_id=genome.id, account_id=first.id, display_name="Paris", sort_order=0),
            ProjectS3Account(project_id=genome.id, account_id=replica.id, display_name="Replica", sort_order=1),
            ProjectS3Account(project_id=climate.id, account_id=remote.id, display_name="Rennes", sort_order=0),
        ]
    )
    db_session.commit()

    summary = AdminMetricsService.build_summary_payload(db_session)
    scoped_summary = AdminMetricsService.build_summary_payload(db_session, endpoint_id=first_endpoint.id)

    assert summary["total_projects"] == 3
    assert summary["total_project_account_links"] == 3
    assert scoped_summary["total_projects"] == 1
    assert scoped_summary["total_project_account_links"] == 2
