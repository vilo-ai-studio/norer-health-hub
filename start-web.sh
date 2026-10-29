#!/bin/sh
set -eu

# El volumen conserva los archivos que aún necesitan las pestañas anteriores.
cp -R /opt/norder-assets/. /srv/assets/
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
