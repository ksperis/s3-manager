#!/bin/sh
set -eu

mkdir -p /tmp/client_temp /tmp/proxy_temp /tmp/fastcgi_temp /tmp/uwsgi_temp /tmp/scgi_temp
envsubst '${CSP_CONNECT_SRC} ${BACKEND_UPSTREAM}' \
  < /etc/nginx/bucketreef.conf.template \
  > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
