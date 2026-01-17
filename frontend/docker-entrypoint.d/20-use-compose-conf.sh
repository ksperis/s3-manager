#!/bin/sh
set -eu

if [ "${NGINX_CONF:-}" = "compose" ] && [ -f /etc/nginx/compose/nginx.compose.conf ]; then
  cp /etc/nginx/compose/nginx.compose.conf /etc/nginx/conf.d/default.conf
fi
