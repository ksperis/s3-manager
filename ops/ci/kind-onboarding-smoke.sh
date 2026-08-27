#!/usr/bin/env bash
# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
set -euo pipefail

readonly CLUSTER_NAME="bucketreef-onboarding-${CI_JOB_ID:-local}"
readonly NAMESPACE="bucketreef-smoke"
readonly RELEASE="bucketreef-smoke"
readonly PUBLIC_HOST="bucketreef.local"
readonly PUBLIC_ORIGIN="https://${PUBLIC_HOST}"
readonly FRONTEND_PORT="18080"
readonly KIND_API_HOST="${KIND_API_HOST:-}"

: "${BACKEND_IMAGE_REPOSITORY:?BACKEND_IMAGE_REPOSITORY is required}"
: "${FRONTEND_IMAGE_REPOSITORY:?FRONTEND_IMAGE_REPOSITORY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"

readonly BACKEND_IMAGE="${BACKEND_IMAGE_REPOSITORY}:${IMAGE_TAG}"
readonly FRONTEND_IMAGE="${FRONTEND_IMAGE_REPOSITORY}:${IMAGE_TAG}"
readonly POSTGRES_IMAGE="postgres:16-alpine"

temporary_directory="$(mktemp -d)"
frontend_forward_pid=""

cleanup() {
  local status=$?
  set +e
  if [[ -n "$frontend_forward_pid" ]]; then
    kill "$frontend_forward_pid" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    kubectl --namespace "$NAMESPACE" get pods -o wide >&2 || true
    kubectl --namespace "$NAMESPACE" describe pods >&2 || true
    kubectl --namespace "$NAMESPACE" logs deployment/${RELEASE}-backend --tail=120 >&2 || true
    kubectl --namespace "$NAMESPACE" logs deployment/${RELEASE}-frontend --tail=120 >&2 || true
  fi
  kind delete cluster --name "$CLUSTER_NAME" >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
  exit "$status"
}
trap cleanup EXIT

for command in docker kind kubectl helm curl jq openssl; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done

load_kind_image() {
  local image="$1"
  local image_os image_arch
  image_os="$(docker image inspect "$image" --format '{{.Os}}')"
  image_arch="$(docker image inspect "$image" --format '{{.Architecture}}')"
  docker save "$image" | docker exec --privileged -i "${CLUSTER_NAME}-control-plane" \
    ctr --namespace=k8s.io images import \
      --platform "${image_os}/${image_arch}" \
      --digests \
      --snapshotter=overlayfs \
      -
}

configure_kind_api_access() {
  [[ -n "$KIND_API_HOST" ]] || return 0

  local api_port api_server kube_cluster
  api_server="$(
    kubectl config view --raw --minify \
      -o jsonpath='{.clusters[0].cluster.server}'
  )"
  api_port="${api_server##*:}"
  kube_cluster="$(
    kubectl config view --raw --minify \
      -o jsonpath='{.contexts[0].context.cluster}'
  )"

  if [[ ! "$api_port" =~ ^[0-9]+$ || -z "$kube_cluster" ]]; then
    printf 'Unable to resolve the Kind API endpoint from kubeconfig.\n' >&2
    exit 1
  fi

  kubectl config set-cluster "$kube_cluster" \
    --server="https://${KIND_API_HOST}:${api_port}" \
    >/dev/null
}

if [[ "${KIND_SMOKE_USE_LOCAL_IMAGES:-false}" == "true" ]]; then
  docker image inspect "$BACKEND_IMAGE" "$FRONTEND_IMAGE" >/dev/null
else
  docker pull "$BACKEND_IMAGE"
  docker pull "$FRONTEND_IMAGE"
fi
docker pull "$POSTGRES_IMAGE"
kind_config_args=()
if [[ -n "$KIND_API_HOST" ]]; then
  if [[ ! "$KIND_API_HOST" =~ ^[a-zA-Z0-9.-]+$ ]]; then
    printf 'Invalid KIND_API_HOST: %s\n' "$KIND_API_HOST" >&2
    exit 1
  fi
  cat >"${temporary_directory}/kind-config.yaml" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  apiServerAddress: "0.0.0.0"
kubeadmConfigPatches:
  - |
    kind: ClusterConfiguration
    apiServer:
      certSANs:
        - "${KIND_API_HOST}"
EOF
  kind_config_args=(--config "${temporary_directory}/kind-config.yaml")
fi
kind create cluster --name "$CLUSTER_NAME" --wait 120s "${kind_config_args[@]}"
configure_kind_api_access
load_kind_image "$BACKEND_IMAGE"
load_kind_image "$FRONTEND_IMAGE"
load_kind_image "$POSTGRES_IMAGE"

kubectl create namespace "$NAMESPACE"

ui_key="$(openssl rand -hex 48)"
api_key="$(openssl rand -hex 48)"
credential_key="$(openssl rand -hex 48)"
cron_token="$(openssl rand -hex 48)"
postgres_password="$(openssl rand -hex 24)"
admin_password="$(openssl rand -base64 24 | tr -d '\n')Aa1!"

kubectl --namespace "$NAMESPACE" create secret generic "${RELEASE}-auth" \
  --from-literal=database-url="postgresql://bucketreef:${postgres_password}@${RELEASE}-postgresql:5432/bucketreef" \
  --from-literal=ui-jwt-keys="[\"${ui_key}\"]" \
  --from-literal=api-jwt-keys="[\"${api_key}\"]" \
  --from-literal=credential-keys="[\"${credential_key}\"]" \
  --from-literal=internal-cron-token="$cron_token"

helm upgrade --install "$RELEASE" helm/bucketreef \
  --namespace "$NAMESPACE" \
  --set-string backend.existingSecret="${RELEASE}-auth" \
  --set-string image.backend.repository="$BACKEND_IMAGE_REPOSITORY" \
  --set-string image.backend.tag="$IMAGE_TAG" \
  --set image.backend.pullPolicy=Never \
  --set-string image.frontend.repository="$FRONTEND_IMAGE_REPOSITORY" \
  --set-string image.frontend.tag="$IMAGE_TAG" \
  --set image.frontend.pullPolicy=Never \
  --set backend.persistence.enabled=false \
  --set postgresql.enabled=true \
  --set postgresql.persistence.enabled=false \
  --set postgresql.image.pullPolicy=Never \
  --set-string postgresql.auth.password="$postgres_password" \
  --wait \
  --timeout 5m

kubectl --namespace "$NAMESPACE" rollout status deployment/${RELEASE}-postgresql --timeout=120s
kubectl --namespace "$NAMESPACE" rollout status deployment/${RELEASE}-backend --timeout=180s
kubectl --namespace "$NAMESPACE" rollout status deployment/${RELEASE}-frontend --timeout=120s

bootstrap_output="$(
  kubectl --namespace "$NAMESPACE" exec deployment/${RELEASE}-backend -- \
    python -m app.scripts.issue_first_admin_bootstrap
)"
bootstrap_url="$(printf '%s\n' "$bootstrap_output" | sed -n 's/^Bootstrap URL: //p')"
bootstrap_token="${bootstrap_url#*#token=}"
[[ -n "$bootstrap_token" && "$bootstrap_token" != "$bootstrap_url" ]]
unset bootstrap_output bootstrap_url

kubectl --namespace "$NAMESPACE" port-forward \
  service/${RELEASE}-frontend "${FRONTEND_PORT}:80" \
  >"${temporary_directory}/frontend-port-forward.log" 2>&1 &
frontend_forward_pid=$!

for _attempt in $(seq 1 60); do
  if curl --fail --silent \
    --header "Host: ${PUBLIC_HOST}" \
    "http://127.0.0.1:${FRONTEND_PORT}/setup/first-admin" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent \
  --header "Host: ${PUBLIC_HOST}" \
  "http://127.0.0.1:${FRONTEND_PORT}/setup/first-admin" \
  >/dev/null

status_before="$(
  curl --fail --silent \
    --header "Host: ${PUBLIC_HOST}" \
    "http://127.0.0.1:${FRONTEND_PORT}/api/auth/bootstrap/first-admin/status"
)"
[[ "$(printf '%s' "$status_before" | jq -r '.available')" == "true" ]]

umask 077
printf '%s' "$(
  jq -nc \
    --arg email 'kind-bootstrap@example.com' \
    --arg name 'Kind Bootstrap Admin' \
    --arg password "$admin_password" \
    '{email: $email, full_name: $name, password: $password, password_confirmation: $password}'
)" >"${temporary_directory}/request.json"

curl --fail --silent --show-error \
  --dump-header "${temporary_directory}/response.headers" \
  --output "${temporary_directory}/response.json" \
  --header "Host: ${PUBLIC_HOST}" \
  --header "Origin: ${PUBLIC_ORIGIN}" \
  --header 'Content-Type: application/json' \
  --header "X-BucketReef-Bootstrap-Token: ${bootstrap_token}" \
  --data @"${temporary_directory}/request.json" \
  "http://127.0.0.1:${FRONTEND_PORT}/api/auth/bootstrap/first-admin"
unset bootstrap_token admin_password

[[ "$(jq -r '.status' "${temporary_directory}/response.json")" == "mfa_enrollment_required" ]]
grep -Eqi '^set-cookie: pre_auth=' "${temporary_directory}/response.headers"
grep -Eqi '^set-cookie: pre_auth=.*Max-Age=300' "${temporary_directory}/response.headers"
grep -Eqi '^set-cookie: pre_auth=.*HttpOnly' "${temporary_directory}/response.headers"

status_after="$(
  curl --fail --silent \
    --header "Host: ${PUBLIC_HOST}" \
    "http://127.0.0.1:${FRONTEND_PORT}/api/auth/bootstrap/first-admin/status"
)"
[[ "$(printf '%s' "$status_after" | jq -r '.available')" == "false" ]]

printf 'Kind onboarding smoke test passed.\n'
