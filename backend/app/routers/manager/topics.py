# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, HTTPException, status

from app.db_models import S3Account, User
from app.models.topic import Topic, TopicConfiguration, TopicCreate, TopicPolicy
from app.routers.dependencies import (
    get_account_context,
    get_audit_logger,
    get_current_account_admin,
)
from app.services.audit_service import AuditService
from app.services.topics_service import TopicsService, get_topics_service

router = APIRouter(prefix="/manager/topics", tags=["manager-topics"])


@router.get("", response_model=list[Topic])
def list_topics(
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    _: User = Depends(get_current_account_admin),
) -> list[Topic]:
    try:
        return service.list_topics(account)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.post("", response_model=Topic, status_code=status.HTTP_201_CREATED)
def create_topic(
    payload: TopicCreate,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> Topic:
    try:
        topic = service.create_topic(
            account,
            payload.name,
            configuration=payload.configuration,
        )
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_topic",
            entity_type="sns_topic",
            entity_id=topic.arn,
            account=account,
            metadata={
                "name": payload.name,
                "configuration_keys": sorted((payload.configuration or {}).keys()),
            },
        )
        return topic
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.delete("/{topic_arn:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topic(
    topic_arn: str,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> None:
    try:
        service.delete_topic(account, topic_arn)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_topic",
            entity_type="sns_topic",
            entity_id=topic_arn,
            account=account,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{topic_arn:path}/policy", response_model=TopicPolicy)
def get_topic_policy(
    topic_arn: str,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    _: User = Depends(get_current_account_admin),
) -> TopicPolicy:
    try:
        policy = service.get_topic_policy(account, topic_arn)
        return TopicPolicy(policy=policy or {})
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{topic_arn:path}/policy", response_model=TopicPolicy)
def put_topic_policy(
    topic_arn: str,
    payload: TopicPolicy,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> TopicPolicy:
    try:
        updated = service.set_topic_policy(account, topic_arn, payload.policy or {})
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_topic_policy",
            entity_type="sns_topic",
            entity_id=topic_arn,
            account=account,
            metadata={"policy_length": len(payload.policy or {})},
        )
        return TopicPolicy(policy=updated)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/{topic_arn:path}/configuration", response_model=TopicConfiguration)
def get_topic_configuration(
    topic_arn: str,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    _: User = Depends(get_current_account_admin),
) -> TopicConfiguration:
    try:
        configuration = service.get_topic_configuration(account, topic_arn)
        return TopicConfiguration(configuration=configuration)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.put("/{topic_arn:path}/configuration", response_model=TopicConfiguration)
def put_topic_configuration(
    topic_arn: str,
    payload: TopicConfiguration,
    account: S3Account = Depends(get_account_context),
    service: TopicsService = Depends(get_topics_service),
    current_user: User = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_logger),
) -> TopicConfiguration:
    try:
        updated = service.set_topic_configuration(account, topic_arn, payload.configuration or {})
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_topic_configuration",
            entity_type="sns_topic",
            entity_id=topic_arn,
            account=account,
            metadata={"configuration_keys": sorted(updated.keys())},
        )
        return TopicConfiguration(configuration=updated)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
