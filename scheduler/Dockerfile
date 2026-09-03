FROM alpine:3.24.1

ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256_AMD64=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1
ARG SUPERCRONIC_SHA256_ARM64=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5

RUN apk add --no-cache ca-certificates curl tzdata \
    && case "$(apk --print-arch)" in \
         x86_64) supercronic_arch=amd64; supercronic_sha256="$SUPERCRONIC_SHA256_AMD64" ;; \
         aarch64) supercronic_arch=arm64; supercronic_sha256="$SUPERCRONIC_SHA256_ARM64" ;; \
         *) echo "Unsupported architecture: $(apk --print-arch)" >&2; exit 1 ;; \
       esac \
    && curl --fail --silent --show-error --location \
         --output /usr/local/bin/supercronic \
         "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${supercronic_arch}" \
    && echo "${supercronic_sha256}  /usr/local/bin/supercronic" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/supercronic \
    && addgroup -g 10001 -S scheduler \
    && adduser -u 10001 -S -D -H -G scheduler scheduler

COPY --chown=10001:10001 ops/cron /opt/cron
COPY --chown=10001:10001 scheduler/entrypoint.sh /usr/local/bin/scheduler-entrypoint
RUN chmod 0755 /usr/local/bin/scheduler-entrypoint /opt/cron/*.sh

USER 10001:10001

ENTRYPOINT ["/usr/local/bin/scheduler-entrypoint"]
