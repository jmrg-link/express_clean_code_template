#!/usr/bin/env bash
# Auto-init de LocalStack: crea el bucket configurado en AWS_S3_BUCKET.
# Se monta en /etc/localstack/init/ready.d/init.sh y LocalStack lo ejecuta
# cuando los servicios están listos.
set -euo pipefail

BUCKET="${AWS_S3_BUCKET:-app-local-bucket}"
REGION="${DEFAULT_REGION:-eu-west-1}"

echo "[localstack-init] Creating bucket s3://${BUCKET} in ${REGION}..."
awslocal s3api create-bucket \
  --bucket "${BUCKET}" \
  --region "${REGION}" \
  --create-bucket-configuration LocationConstraint="${REGION}" \
  2>&1 || echo "[localstack-init] Bucket may already exist, continuing."

echo "[localstack-init] Done."
