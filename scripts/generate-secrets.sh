#!/usr/bin/env bash
# =============================================================================
# generate-secrets.sh
# Genera todos los secrets necesarios para .env y los imprime en formato KEY=value.
# Uso:
#   ./scripts/generate-secrets.sh > .env.secrets
#   cat .env.secrets >> .env.local
# =============================================================================
set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl no está instalado. Apt: sudo apt install openssl" >&2
  exit 1
fi

# 32 chars base64 (suficiente para AES-256 y para el plugin OIDC)
gen32() { openssl rand -base64 32 | tr -d '\n=' | head -c 32; }

# 64 chars (para JWT_SECRET fallback)
gen64() { openssl rand -base64 64 | tr -d '\n=' | head -c 64; }

# Genera basicauth para Traefik (admin: <password aleatorio>).
#
# IMPORTANTE: el hash bcrypt contiene `$` (p.ej. `$2y$05$...`). Como este
# valor se pega en `.env*` y docker-compose v2 expande variables al cargar
# el archivo (`$VAR` -> ""), DUPLICAMOS los `$` aqui (`$$`). En docker-compose
# `$$` se desescapa a un unico `$` antes de llegar a Traefik. Si pegases el
# hash literal, veras: WARN[...] The "..." variable is not set.
gen_traefik_auth() {
  local password line
  password=$(gen32)
  if ! command -v htpasswd >/dev/null 2>&1; then
    local hash
    hash=$(openssl passwd -apr1 "$password")
    line="admin:$hash"
  else
    line=$(htpasswd -nbB admin "$password")
  fi
  echo "${line//\$/\$\$}"
  echo "# Traefik dashboard password (admin): $password" >&2
}

cat <<EOF
# ===== Secrets generados $(date -u +"%Y-%m-%dT%H:%M:%SZ") =====
OIDC_PLUGIN_SECRET=$(gen32)
KC_PANELS_SECRET=$(gen32)
KC_API_SECRET=$(gen32)
KC_ADMIN_PASSWORD=$(gen32)
JWT_SECRET=$(gen64)
GRAFANA_ADMIN_PASSWORD=$(gen32)
TRAEFIK_AUTH=$(gen_traefik_auth)
EOF

echo ""
echo "✅ Secrets generados. Pásalos a .env.local / .env.staging / .env.production."
echo "⚠️  NO los commitees. .gitignore ya excluye .env*."
