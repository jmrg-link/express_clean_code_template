# Flujo — Pipeline GitHub Actions

Las ramas de feature pasan por staging, luego producción, con tests en cada paso.

## Puntos de activación

### Feature branch → PR a staging

**Activador:** `git push origin feature/slug`

**Workflows ejecutados:**
1. `test.yml` — tests unitarios + integración
2. `lint.yml` — ESLint + Prettier
3. `security.yml` — trivy, npm audit

**Resultado:** PR listo para review

**Checklist antes de push:**
```bash
npm run lint:fix
npm run format
npm run test
npm run build
```

### Rama staging

**Activador:** Merge PR a `staging`

**Workflows ejecutados:**
1. `deploy-staging.yml` — auto-deploy a EC2 staging

**Pasos:**
```
1. Checkout code
2. Build Docker image
3. SSH to EC2
4. Fetch .env.staging vars
5. docker-compose --profile staging down
6. docker-compose --profile staging up -d
7. Smoke tests (curl /health)
```

**Resultado:** Cambios live en `staging.api.example.com`

### Rama main

**Activador:** Merge PR a `main`

**Workflows ejecutados:**
1. `test.yml` (suite completa) — cobertura, E2E
2. `lint.yml` — verificación final
3. `security.yml` — escaneo completo

**En espera:** Aprobación manual para deploy

**Resultado:** Listo para producción si todos pasan

### Producción

**Activador:** Trigger manual en GitHub UI (Actions → deploy-production → Run workflow)

**Workflows ejecutados:**
1. `deploy-production.yml` — deploy a EC2 prod

**Pasos:**
```
1. All checks from main rerun
2. AWS OIDC authentication
3. Fetch secrets from AWS Secrets Manager
4. SSH to EC2 prod
5. Fetch latest code
6. docker-compose --profile production down
7. docker-compose --profile production up -d
8. Health checks
9. Smoke tests
```

**Resultado:** Cambios live en `api.example.com`

## Reglas de protección de ramas

**Rama main:**
- Requiere 2 revisiones de código antes de merge
- Requiere que status checks pasen (test, lint, security)
- Requiere que ramas estén actualizadas

**Rama staging:**
- Requiere 1 revisión de código antes de merge
- Requiere que status check de test pase

## Verificaciones de estado

| Check | Requisito |
|---|---|
| `test` | Pass (tests ≥75% coverage) |
| `lint` | Pass (no linting errors) |
| `security` | Pass (no known vulnerabilities) |
| `build` | Pass (TypeScript compiles) |

Todos deben pasar antes de merge.

## Ejemplo: flujo completo

```
1. Developer crea feature branch
   git checkout -b feature/new-endpoint

2. Code + commit
   git add .
   git commit -m "feat(api): add new endpoint"

3. Push
   git push origin feature/new-endpoint
   → GitHub Actions: test, lint, security

4. Create PR en GitHub
   → PR description con checklist
   → Assign 2 reviewers

5. Reviewers aprueban
   → PR status: ✓ All checks passed, ✓ Approved

6. Merge a staging
   → GitHub Actions: deploy-staging.yml
   → Deploy a EC2 staging automáticamente
   → Live en staging.api.example.com

7. QA testa en staging

8. Developer crea PR staging → main
   → Same review process

9. Merge a main
   → GitHub Actions: full test suite
   → Status: waiting for manual approval

10. DevOps/Lead aprueba deployment
    → Manual trigger en Actions UI
    → deploy-production.yml corre
    → Deploy a EC2 prod
    → Live en api.example.com
```

## Reversión

Si algo falla en production:

```bash
# Opción 1: Revert último commit
git revert <commit-hash>
git push origin main
# → Workflows corre, espera approval
# → Manual trigger deploy-production
# → Rollback live

# Opción 2: Fix + new commit
git checkout main
git pull origin main
git checkout -b fix/critical-issue
# Fix code
git commit -m "fix: critical issue"
git push origin fix/critical-issue
# → Create PR, 2 reviews, merge
# → Same approval flow para prod
```

## Monitoreo de despliegues

### GitHub UI

```
Actions → workflow run → job details → logs
```

### CloudWatch (producción)

```
AWS Console → CloudWatch → Logs → /aws/ec2/api-prod
```

### Verificación de salud

```bash
curl https://api.example.com/health
# Expected: 200 OK
```

## Resolución de problemas

### "Tests fail in CI but pass locally"
```bash
# Reinstall deps (puede tener desync)
rm -rf node_modules package-lock.json
npm install
npm test
```

### "Deployment fails after merge"
```bash
# Check logs en GitHub Actions
Actions → failed workflow run → Logs tab

# SSH into EC2 directamente
ssh -i key.pem ec2-user@<ip>
docker logs app-api | tail -100
```

### "Stuck waiting for approval"
```bash
# Manual approval gate en GitHub
Settings → Environments → production
# Revisar who can approve (CODEOWNERS)
```
