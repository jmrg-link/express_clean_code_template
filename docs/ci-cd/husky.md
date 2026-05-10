# Husky — Git Hooks

Block commits that are broken or badly formatted. Block pushes that fail tests.

## Qué?

Husky runs code before you commit. If it fails, the commit doesn't happen.

## Por qué?

Broken code shouldn't be committed. Bad messages clog the log. Tests that fail shouldn't be pushed.

## Para qué?

- Lint/format antes de commitear (lint-staged + ESLint)
- Validar mensaje de commit (Conventional Commits)
- Tests antes de pushear (guarantee no red flags en CI)
- Auditoría clara vía `git log`

## Stack de Husky

```
Husky (orquestador de hooks)
├── lint-staged (solo archivos staged)
├── ESLint + Prettier (linting)
├── commitlint (validar commit messages)
└── vitest (tests antes de push)
```

## Instalación

### 1. Instalar dependencias

```bash
pnpm add -D husky lint-staged @commitlint/cli @commitlint/config-conventional
```

### 2. Inicializar Husky

```bash
npx husky install
```

Crea carpeta `.husky/` con hooks.

### 3. Configurar pre-commit (lint-staged)

```bash
npx husky add .husky/pre-commit "npx lint-staged"
```

Genera `.husky/pre-commit`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx lint-staged
```

### 4. Configurar commit-msg (commitlint)

```bash
npx husky add .husky/commit-msg "npx commitlint --edit $1"
```

Genera `.husky/commit-msg`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx commitlint --edit $1
```

### 5. Configurar pre-push (tests)

```bash
npx husky add .husky/pre-push "pnpm test:unit && tsc --noEmit"
```

Genera `.husky/pre-push`:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

pnpm test:unit && tsc --noEmit
```

## Configuración lint-staged

En `package.json`:

```json
{
  "lint-staged": {
    "src/**/*.ts": [
      "eslint --fix",
      "prettier --write"
    ],
    "test/**/*.ts": [
      "eslint --fix"
    ]
  }
}
```

O en `.lintstagedrc.json`:

```json
{
  "src/**/*.ts": ["eslint --fix", "prettier --write"],
  "test/**/*.ts": ["eslint --fix"]
}
```

## Configuración commitlint

En `commitlint.config.js`:

```javascript
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "test", "chore", "ci", "auth", "user", "storage", "audit", "infra", "compose"]
    ],
    "scope-empty": [2, "never"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "type-case": [2, "always", "lowercase"],
    "scope-case": [2, "always", "lowercase"]
  }
}
```

**Scopes permitidos:**
- `auth` — autenticación (Keycloak, JWT, sessions)
- `user` — gestión de usuarios
- `storage` — S3, archivos
- `audit` — logging, Observer
- `infra` — Docker, Traefik, networking
- `docs` — documentación
- `test` — tests
- `ci` — CI/CD
- `compose` — docker-compose
- Otros: según dominio

## Flujo en acción

### Commit válido

```bash
$ git commit -m "feat(auth): add JWT refresh token"

> husky - Git hooks
> pre-commit: npx lint-staged
  ✓ src/infrastructure/auth/jwt.service.ts (fixed 2 issues)
> commit-msg: npx commitlint
  ✓ commit message valid
✓ Committed
```

### Commit inválido (linting error)

```bash
$ git commit -m "feat(auth): add JWT refresh token"

> husky - pre-commit
  ✗ src/infrastructure/auth/jwt.service.ts
    34:5  error  Unexpected var, use let or const

Fix errors and retry.
```

Dev corre `eslint --fix` manualmente o wait para que lint-staged lo haga.

### Commit inválido (mensaje)

```bash
$ git commit -m "Add JWT token"

> husky - commit-msg
  ✗ subject may not be empty [type-enum]
  ✗ type must be one of [feat, fix, ...] [type-enum]

Fix commit message: git commit --amend
```

### Push con tests fallando

```bash
$ git push origin feature/auth

> husky - pre-push
  FAIL  test/unit/auth.test.ts
    ✗ JWT refresh should return new token
    
Run 'pnpm test:unit' locally to debug.
```

Push bloqueado. Dev corre `pnpm test:watch` para debuguear.

## Bypass (SOLO emergencias)

**Cuándo usar:** Solo en emergencias críticas (rollback urgent en prod, hotfix que necesita ir directo).

```bash
# Skip pre-commit + commit-msg (no lint, no message validation)
git commit --no-verify -m "hotfix: disable SSL temporarily"

# Skip pre-push (no tests)
git push --no-verify
```

**NUNCA:**
- Merge a `main` con `--no-verify`
- Usar bypass en PRs (breaks audit trail)
- Sin antes notificar al equipo

**Mejores prácticas:**
- Documentar en commit body por qué se skippeó
- Crear issue follow-up: "verify tests pass in CI after hotfix"
- Revertir bypass tan pronto como sea posible

## Troubleshooting

### Husky no ejecuta

```bash
# Verificar que está instalado
ls -la .husky/

# Si no existe, reinstalar
npx husky install

# Verificar permisos
ls -la .husky/pre-commit
# Should be: -rwxr-xr-x (executables)

# Si no, fix permisos
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
chmod +x .husky/pre-push
```

### "Husky is disabled" en CI

En GitHub Actions o CI, Husky está desabilitado por default. **Esto es correcto** — CI tiene sus propios workflows.

Si necesitas forzar hooks en CI (raro):

```bash
# En workflow step antes de commit
HUSKY=0 git commit -m "..."
```

### "Permission denied: .husky/pre-commit"

```bash
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
chmod +x .husky/pre-push

# Commit permisos al repo
git add .husky/
git commit -m "chore: fix hook permissions"
```

### lint-staged ejecuta en archivos que no cambié

lint-staged corre solo en archivos staged:

```bash
# Ver staging area
git diff --cached

# Si viste archivos que no querías, unstage
git reset HEAD path/to/file.ts

# Luego commit solo lo que querías
```

### Hook execution order

Husky ejecuta en este orden:

1. `pre-commit` (lint-staged)
2. `commit-msg` (commitlint)
3. Commit completado
4. `pre-push` (tests)
5. Push completado

Si `pre-commit` falla → `commit-msg` no corre.
Si `commit-msg` falla → commit no se hace.
Si `pre-push` falla → push se bloquea.

## Integración con CI/CD

### Local (Husky activo)

```
dev runs: git commit → pre-commit (lint-staged) → commit-msg (commitlint) → push → pre-push (tests)
```

### CI/CD (Husky deshabilitado)

```yaml
# .github/workflows/ci.yml
- name: Install deps
  run: pnpm install

- name: Lint
  run: pnpm lint

- name: Tests
  run: pnpm test:unit

- name: Build
  run: pnpm build
```

**Nota:** CI corre los mismos checks pero en todos los archivos, no solo staged.

## Notas de desarrollo

| Caso | Acción |
|------|--------|
| Quiero commitear sin lint | `git commit --no-verify` (solo emergencias) |
| Quiero ver qué va a lintear | `git diff --cached` luego `eslint` manualmente |
| Quiero revertir commit | `git reset HEAD~1` (keep changes) o `git revert <hash>` |
| lint-staged es lentísimo | Reduce scope en `.lintstagedrc`: solo `.ts` files |
| Pre-push tests tardan demasiado | Corre `pnpm test:unit` en local, no la suite full |

## Referencias

- [Husky docs](https://typicode.github.io/husky/)
- [lint-staged docs](https://github.com/lint-staged/lint-staged)
- [commitlint docs](https://commitlint.js.org/)
- [`docs/ci-cd/README.md`](./README.md) — overview CI/CD
- [`docs/project/contributing.md`](../project/contributing.md) — coding standards
