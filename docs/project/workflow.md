# Workflow — Git, Commits, PR

Define el flujo de desarrollo desde checkout de rama hasta merge a main y deployment a producción.

## Estructura de branches

```
main (←— only merges from PRs, protected)
  ↓
staging (←— feature/fix branches, auto-deploy on merge)
  ↓
feature/<slug> (←— new functionality)
fix/<slug>     (←— bug fixes)
```

### Responsabilidades de cada rama

| Rama | Protección | Deploy | Descripción |
|---|---|---|---|
| `main` | Sí (2 reviews requeridas) | Manual a producción | Source of truth productivo |
| `staging` | No | Auto al merge | Entorno de pre-producción |
| `feature/<slug>` | No | N/A | Rama de desarrollo nueva feature |
| `fix/<slug>` | No | N/A | Rama de bugfix |

## Flujo típico: nueva feature

```bash
# 1. Crear rama desde staging (siempre staging, nunca main)
git checkout staging
git pull origin staging
git checkout -b feature/user-profile-page

# 2. Desarrollar + commit frecuente con Conventional Commits
git add src/...
git commit -m "feat(user): add profile endpoint"
git commit -m "feat(user): add profile entity to schema"
git commit -m "test(user): add integration tests for profile"

# 3. Push antes de crear PR
git push origin feature/user-profile-page

# 4. GitHub: crear PR contra staging
#    - Title: "feat(user): implement user profile page"
#    - Description: usar template (ver abajo)
#    - Assign reviewers: 2 mandatory

# 5. CI checks corren automáticamente
#    - lint ✓
#    - test ✓
#    - coverage ✓
#    - build ✓

# 6. Reviews aprobadas → Merge (squash recomendado)
#    GitHub crea commit final en staging

# 7. Staging CI/CD
#    - Auto-deploy a staging.api.example.com
#    - Smoke tests en endpoint

# 8. QA en staging, luego PR a main
git checkout staging
git pull origin staging
#    Crear PR staging → main (2 reviews)

# 9. Merge a main
#    → GitHub Actions full suite
#    → Manual approval → Production deployment
```

## Flujo típico: bugfix

Idéntico a feature, pero rama `fix/<slug>`:

```bash
git checkout staging
git pull origin staging
git checkout -b fix/auth-token-expiry-bug

# Commit con fix:
git commit -m "fix(auth): handle token expiry gracefully"
git commit -m "test(auth): add regression test for expiry"

# Push → PR → Reviews → Merge a staging
# Si es crítico: merge directo a main después de staging approval
```

## Convenciones de commit (Conventional Commits 1.0.0)

### Formato base

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types permitidos

| Type | Descripción | SemVer | Ejemplo |
|---|---|---|---|
| `feat` | Nueva feature | MINOR | `feat(auth): add 2FA via TOTP` |
| `fix` | Bug fix | PATCH | `fix(user): prevent duplicate email registration` |
| `docs` | Solo documentación | — | `docs(api): update endpoint description` |
| `style` | Formato sin cambio funcional | — | `style: reformat code` |
| `refactor` | Refactor sin cambio funcional | — | `refactor(auth): extract JWT validation to helper` |
| `perf` | Mejora performance | PATCH | `perf(db): add index to user email` |
| `test` | Tests nuevos/modificados | — | `test(user): add unit test for paginator` |
| `build` | Build system / deps | — | `build: upgrade express to 5.2.1` |
| `ci` | CI/CD changes | — | `ci: add security scan to GitHub Actions` |
| `chore` | Misc (no code impact) | — | `chore: update .gitignore` |

### Scopes recomendados

```
auth, user, storage, audit, infra, docs, test, ci, compose, config
```

### Ejemplos válidos

```bash
# Simple
git commit -m "feat(auth): add refresh token rotation"

# Con body
git commit -m "feat(user): implement soft delete

Soft delete permite recuperar usuarios accidentalmente borrados.
Marca deleted_at field sin remover documento.

Implements: #42"

# Breaking change
git commit -m "feat(api)!: change user response schema

BREAKING CHANGE: response.user.profile is now response.user.data"

# Con footer
git commit -m "fix(auth): prevent timing attacks in token comparison

Use secure string comparison (jose built-in).

Closes: #123
Reviewed-by: alice@example.com"
```

### Anti-patrones

```bash
# ✗ Mal: no type ni scope
git commit -m "update stuff"

# ✗ Mal: type en minúsculas, scope mal
git commit -m "Fix(User): changed password logic"

# ✗ Mal: descripción muy larga en title
git commit -m "feat: this is a very long description that should be in body"

# ✗ Mal: AI reference
git commit -m "feat(auth): implemented with AI assistance" # ← NO

# ✓ Bien
git commit -m "feat(auth): add JWT validation with JWKS"
```

## Crear un Pull Request

### Checklist pre-PR

Antes de `git push origin <branch>`, verifica:

```bash
# 1. Build y tests pasan localmente
npm run build
npm run test
npm run test:coverage  # Mínimo 75%

# 2. Lint sin errores
npm run lint:fix
npm run format

# 3. No hay archivos sensibles (.env, secrets)
git status  # Revisar que NO haya .env.local, .env.production, etc.

# 4. Commits claros y atómicos
git log --oneline <tu-rama>..origin/staging  # Revisar commits
```

### Template de descripción PR

Copia esto en GitHub cuando crees PR:

```markdown
## Descripción
Brief 1-2 sentence description of the change.

## Tipo de cambio
- [ ] Bugfix (breaking change? NO)
- [ ] Feature nueva (breaking change? NO)
- [ ] Breaking change (cambio de API)
- [ ] Documentación

## Cómo testear
Instrucciones paso a paso para QA/revisor:
1. Ejecutar `npm run dev`
2. Hacer POST a `/api/v1/...`
3. Verificar que responde `200` con schema correcto

## Checklist
- [ ] Mi código sigue code standards (JSDoc, no comentarios inline)
- [ ] Tests agregados/modificados (mínimo 75% coverage)
- [ ] No hay cambios sin relación al scope
- [ ] Documentación actualizada (si aplica)
- [ ] Sin valores reales de .env (solo names)
- [ ] Commits son Conventional Commits claros
- [ ] `npm run lint:fix && npm run format` ejecutado

## Screenshots / Logs (si aplica)
Curl request / response, dashboard, etc.

## Issues relacionados
Closes #42
Refs #100
```

### Ejemplo completo

**Title:**
```
feat(user): implement user profile endpoint
```

**Body:**
```markdown
## Descripción
Agrega endpoint GET /api/v1/users/:id para obtener perfil completo del usuario.

## Cambios
- New endpoint: `GET /api/v1/users/:id`
- New schema: `UserProfileDto` con validate middleware
- New use-case: `FindUserProfileUseCase`
- Update Swagger JSDoc

## Tipo de cambio
- [x] Feature nueva
- [ ] Breaking change

## Cómo testear
1. npm run dev
2. curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/users/507f1f77bcf86cd799439011
3. Responde 200 con user profile

## Checklist
- [x] Tests agregados
- [x] JSDoc en clases/funciones públicas
- [x] Lint + format ejecutado
- [x] No hay .env.production en commit

Closes #156
```

## Políticas de merge

### Para staging
- **Reviewers requeridas**: 1
- **Tests requeridos**: Sí (GitHub Actions check)
- **Merge strategy**: Squash (opcional, pero recomendado)
- **Delete branch**: Automático después de merge

### Para main
- **Reviewers requeridas**: 2
- **Tests requeridos**: Sí (full suite)
- **Protected**: Sí
- **Merge strategy**: Squash obligatorio
- **Require PR reviews before merge**: Sí
- **Dismiss stale reviews**: No
- **Require code owner review**: No (por ahora)

## Después del merge: deployment

### Staging (automático)
```bash
# GitHub Actions triggered on: merge to staging
- Install deps
- Build
- Unit + integration tests
- Lint check
- Deploy to staging.api.example.com via ECS/EC2
- Smoke tests
```

### Production (manual)
```bash
# GitHub Actions available on: main branch
# Requires: manual approval in GitHub UI

- Install deps
- Build
- Full test suite
- Security scan
- Lint + coverage checks
- [Manual approval via GitHub environment]
- Deploy to api.example.com via ECS/EC2
```

## Revertir commits

Si un commit merged a staging es problemático:

```bash
git revert <commit-hash>
git push origin staging
# Esto crea un nuevo commit que deshace los cambios
# No hace fuerza, es seguro
```

Si es crítico en main:

```bash
git revert <commit-hash>
git push origin main
# Luego lo mismo: requiere PR si está protegida
```

**Nunca hagas `git reset --hard` en ramas remotas protegidas.**

## Rollback en producción

Si algo falla en production después de deployment:

```bash
# Opción 1: revert anterior commit (recomendado)
git revert <problematic-commit-hash>
git push origin main
# Esperar CI, luego manual approve deployment

# Opción 2: fix rápido + new commit
git checkout main
git pull origin main
git checkout -b fix/critical-bug
# Fix code
git commit -m "fix: critical issue in production"
git push origin fix/critical-bug
# Create PR, 2 reviews, merge
# Manual deploy
```

## Seguridad

### Secrets en commits

**Nunca:**
```bash
git add .env.production
git add credentials.json
git add api-keys.txt
```

**Siempre:**
```bash
# Use .gitignore
echo ".env.production" >> .gitignore

# Use GitHub Secrets para CI/CD
# → .github/workflows/deploy.yml accede via ${{ secrets.DB_PASSWORD }}

# Variables en código solo como defaults vía Zod
# → src/config/env.ts con defaults seguros
```

### Pre-commit hooks (via Husky)

El repo tiene `.husky/pre-commit`:
- Ejecuta `npm run lint:fix`
- Bloquea commits con errores linting
- No bloquea por warnings

Así que antes de push:

```bash
git commit -m "feat(auth): ..."
# ↓ Husky corre lint:fix automáticamente
# ↓ Si hay errores, commit fallido
# ↓ Fix los errores, retry commit
```

## Troubleshooting

### "My PR shows merge conflicts"
```bash
git fetch origin
git merge origin/staging  # O origin/main
git push origin feature/myfeature
# GitHub recalcula conflicts
```

### "I committed en main por error"
```bash
git reset --soft HEAD~1  # Deshacer último commit, keep changes
git checkout -b fix/oops  # Nueva rama
git commit -m "fix: ..."
git push origin fix/oops
# Luego PR contra staging
```

### "CI falló pero quiero ver logs"
Ir a GitHub → Actions → workflow run → ver detalles de cada job.

### "Test pasa local pero falla en CI"
Probable: diferencia de dependencias o env vars.
```bash
# Reinstalar deps igual a CI
rm -rf node_modules package-lock.json
npm install
npm test
```

## Referencias

- Conventional Commits: [`.firecrawl/conventional-commits.md`](../../.firecrawl/conventional-commits.md)
- Code Standards: [`.claude/rules/jsdoc-tsdoc.md`](../../.claude/rules/jsdoc-tsdoc.md)
- Full docs: [`docs/project/contributing.md`](./contributing.md)
