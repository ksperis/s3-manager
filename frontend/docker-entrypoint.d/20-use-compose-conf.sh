#!/bin/sh
set -eu

if [ "${NGINX_CONF:-}" = "compose" ] && [ -f /etc/nginx/conf.d/nginx.compose.conf ]; then
  cp /etc/nginx/conf.d/nginx.compose.conf /etc/nginx/conf.d/default.conf
fi
