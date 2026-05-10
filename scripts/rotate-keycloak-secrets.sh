#!/usr/bin/env bash
#
# rotate-keycloak-secrets.sh
#
# Rota los client secrets del realm `app` usando kcadm dentro del contenedor
# keycloak. Pensado para ejecutarse despues del PRIMER arranque en staging /
# produccion (o cuando se quiera rotar credenciales). NO modifica el realm
# JSON commiteado en keycloak/app-realm.json — el cambio es runtime.
#
# Variables requeridas (sin defaults):
#   KC_ADMIN_USER       Admin del master realm.
#   KC_ADMIN_PASSWORD   Password del admin.
#   KC_API_SECRET       Nuevo secret para el client `app-api`.
#   KC_PANELS_SECRET    Nuevo secret para el client `traefik-panels`.
#
# Variables opcionales:
#   KC_URL              URL interna de Keycloak (default: http://keycloak:8080).
#   KC_REALM            Realm objetivo (default: app).
#   KC_CONTAINER        Nombre del contenedor docker (default: keycloak).
#
# Uso:
#   ./scripts/rotate-keycloak-secrets.sh
#
# Modo dry-run: si pasas DRY_RUN=1 imprime los comandos sin ejecutarlos.

set -euo pipefail

: "${KC_ADMIN_USER:?KC_ADMIN_USER es requerido}"
: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD es requerido}"
: "${KC_API_SECRET:?KC_API_SECRET es requerido}"
: "${KC_PANELS_SECRET:?KC_PANELS_SECRET es requerido}"

KC_URL="${KC_URL:-http://keycloak:8080}"
KC_REALM="${KC_REALM:-app}"
KC_CONTAINER="${KC_CONTAINER:-keycloak}"
KCADM="/opt/keycloak/bin/kcadm.sh"

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "[dry-run] docker exec $KC_CONTAINER $*"
  else
    docker exec "$KC_CONTAINER" "$@"
  fi
}

echo "→ Autenticando contra master de Keycloak en $KC_URL"
run "$KCADM" config credentials \
  --server "$KC_URL" \
  --realm master \
  --user "$KC_ADMIN_USER" \
  --password "$KC_ADMIN_PASSWORD"

echo "→ Resolviendo client IDs en realm $KC_REALM"
API_ID=$(run "$KCADM" get clients -r "$KC_REALM" -q clientId=app-api --fields id --format csv --noquotes | tail -n 1 | tr -d '\r')
PANELS_ID=$(run "$KCADM" get clients -r "$KC_REALM" -q clientId=traefik-panels --fields id --format csv --noquotes | tail -n 1 | tr -d '\r')

if [[ -z "$API_ID" || -z "$PANELS_ID" ]]; then
  echo "✗ No se pudieron resolver los IDs de los clients (app-api / traefik-panels)" >&2
  exit 1
fi

echo "→ Rotando secret de app-api ($API_ID)"
run "$KCADM" update "clients/$API_ID" -r "$KC_REALM" -s "secret=$KC_API_SECRET"

echo "→ Rotando secret de traefik-panels ($PANELS_ID)"
run "$KCADM" update "clients/$PANELS_ID" -r "$KC_REALM" -s "secret=$KC_PANELS_SECRET"

echo "✓ Secrets rotados. Recuerda actualizar tambien:"
echo "  - .env.production / .env.staging con KC_API_SECRET=$KC_API_SECRET (en la API)"
echo "  - El plugin OIDC de Traefik con el nuevo KC_PANELS_SECRET"
echo "  - Reiniciar contenedores api y traefik para que tomen los nuevos valores"
