#!/bin/sh
set -eu

fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT HUP INT TERM
mkdir -p "$fixture/source/fonts" "$fixture/live" "$fixture/bin"
printf 'anterior' > "$fixture/live/previous-hash.js"
printf 'existente' > "$fixture/live/same-hash.js"
printf 'existente' > "$fixture/source/same-hash.js"
printf 'actual' > "$fixture/source/new-hash.js"
printf 'fuente' > "$fixture/source/fonts/inter-v20.woff2"
printf '#!/bin/sh\n[ "$*" = "run --config /etc/caddy/Caddyfile --adapter caddyfile" ]\n' > "$fixture/bin/caddy"
chmod +x "$fixture/bin/caddy"
sed -e "s|/opt/norder-assets|$fixture/source|g" -e "s|/srv/assets|$fixture/live|g" start-web.sh > "$fixture/start-web.sh"
PATH="$fixture/bin:$PATH" sh "$fixture/start-web.sh"
PATH="$fixture/bin:$PATH" sh "$fixture/start-web.sh"
test "$(cat "$fixture/live/previous-hash.js")" = anterior
test "$(cat "$fixture/live/same-hash.js")" = existente
test "$(cat "$fixture/live/new-hash.js")" = actual
test "$(cat "$fixture/live/fonts/inter-v20.woff2")" = fuente
echo 'PASS: conserva archivos anteriores y agrega los nuevos al reiniciar.'
