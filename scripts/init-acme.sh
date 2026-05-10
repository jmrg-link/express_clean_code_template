#!/usr/bin/env bash
# =============================================================================
# init-acme.sh
# Garantiza que ./data/traefik/acme/acme.json existe y tiene permisos 600.
# Traefik lo requiere así (la doc oficial es explícita); si el archivo no
# existe o tiene permisos incorrectos, Traefik se niega a arrancar.
#
# Idempotente: ejecutarlo varias veces es seguro.
#
# Uso:
#   ./scripts/init-acme.sh
# =============================================================================
set -euo pipefail

ACME_DIR="$(dirname "$0")/../data/traefik/acme"
ACME_FILE="$ACME_DIR/acme.json"

mkdir -p "$ACME_DIR"

if [ ! -f "$ACME_FILE" ]; then
  echo "Creating $ACME_FILE..."
  touch "$ACME_FILE"
fi

# Permisos 600: solo el dueño puede leer/escribir.
chmod 600 "$ACME_FILE"

echo "✅ ACME storage ready: $ACME_FILE (mode 600)"
ls -la "$ACME_FILE"
