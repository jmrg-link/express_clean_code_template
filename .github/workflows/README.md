# GitHub Actions workflows

Workflows that build the API container, push to ECR, and roll the service forward on Fargate via OIDC. No long-lived AWS credentials are stored in GitHub — each job assumes a deploy role via OIDC.

## Workflows

| File | Trigger | Target |
|------|---------|--------|
| `deploy-api-staging.yml` | push to `staging`, manual dispatch | staging ECS service |
| `deploy-api-prod.yml` | push to `main`, manual dispatch | prod ECS service (GitHub Environment `prod` with required reviewers) |

Both build with `docker buildx` for `linux/arm64` (Fargate Graviton), tag `<env>-<git-sha>`, fetch the live task definition with `aws ecs describe-task-definition`, swap the image via `amazon-ecs-render-task-definition`, and update the service. No task-definition JSON is committed in the repo.

## Required configuration

Configure these once at the repository level (Settings → Secrets and variables → Actions).

### Repository variables (`vars.*`)

| Name | Where to get it |
|------|-----------------|
| `AWS_REGION` | `terraform output aws_region` (or whatever region was applied) |
| `ECS_CLUSTER` | `terraform output ecs_api_cluster_name` |
| `ECS_SERVICE_STAGING` | `terraform output ecs_api_service_name_staging` |
| `ECS_SERVICE_PROD` | `terraform output ecs_api_service_name_prod` |
| `ECR_REPOSITORY_STAGING` | `terraform output ecr_api_staging_name` |
| `ECR_REPOSITORY_PROD` | `terraform output ecr_api_prod_name` |

### Repository secrets (`secrets.*`)

| Name | Where to get it |
|------|-----------------|
| `AWS_DEPLOY_ROLE_STAGING` | `terraform output github_deploy_role_arn_staging` |
| `AWS_DEPLOY_ROLE_PROD` | `terraform output github_deploy_role_arn_prod` |

### GitHub Environment

Create an Environment named `prod` (Settings → Environments → New environment). Add required reviewers and any branch protection rules. The prod deploy role trust policy is scoped to `environment:prod`, so the job cannot assume the role outside this environment.

## CLI bootstrap

After `terraform apply`:

```bash
# Variables
gh variable set AWS_REGION             -b "$(terraform output -raw aws_region)"
gh variable set ECS_CLUSTER            -b "$(terraform output -raw ecs_api_cluster_name)"
gh variable set ECS_SERVICE_STAGING    -b "$(terraform output -raw ecs_api_service_name_staging)"
gh variable set ECS_SERVICE_PROD       -b "$(terraform output -raw ecs_api_service_name_prod)"
gh variable set ECR_REPOSITORY_STAGING -b "$(terraform output -raw ecr_api_staging_name)"
gh variable set ECR_REPOSITORY_PROD    -b "$(terraform output -raw ecr_api_prod_name)"

# Secrets
gh secret set AWS_DEPLOY_ROLE_STAGING -b "$(terraform output -raw github_deploy_role_arn_staging)"
gh secret set AWS_DEPLOY_ROLE_PROD    -b "$(terraform output -raw github_deploy_role_arn_prod)"
```

## First run notes

- Terraform registers the first task definition revision with a placeholder `nginx:alpine` image. Containers will start but fail the `/health/live` healthcheck. Trigger `deploy-api-staging.yml` (workflow_dispatch) to roll out the real image.
- The container name in both workflows must match `container_name` from the task definition (default `api`).
- ARM64 builds need `docker/setup-buildx-action` because the GitHub-hosted runners are x86_64; QEMU + buildx handle the cross-compile.
