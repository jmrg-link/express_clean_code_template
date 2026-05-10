# IAM — Access Control

Users, roles, policies, and service accounts control who can do what in AWS.

## Estructura

```
Root Account (root-account@example.com)
  ├── Admin User (admin@example.com, MFA)
  └── Programmatic Users
        ├── github-actions (OIDC federation)
        └── ec2-instance (service role)

Service Roles
  ├── ec2-mongodb-role (EC2 → S3, Secrets Manager)
  └── github-actions-role (GitHub Actions → EC2, ECS)
```

## Root Account

**Email:** root-account@example.com
**MFA:** Required (authenticator app)
**Usage:** Never use directly; use Admin user instead

## Admin User

**Name:** admin@example.com
**Type:** IAM user (legacy; futuro: SSO)
**MFA:** Required
**Permissions:** AdministratorAccess (full AWS access)

```bash
# Create
aws iam create-user --user-name admin@example.com
aws iam attach-user-policy --user-name admin@example.com \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# MFA
aws iam enable-mfa-device --user-name admin@example.com \
  --serial-number arn:aws:iam::ACCOUNT:mfa/admin@example.com \
  --authentication-code1 123456 \
  --authentication-code2 654321
```

## GitHub Actions (OIDC)

**Type:** Service account via OpenID Connect (no static keys)
**Trust:** GitHub Actions workflows en repo jmrg/express-clean-backend

```bash
# Create OIDC provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com

# Create role
aws iam create-role --role-name github-actions-role \
  --assume-role-policy-document @trust-policy.json
  # trust-policy.json: GitHub Actions can assume this role

# Attach policy (EC2, ECS, S3 access)
aws iam put-role-policy --role-name github-actions-role \
  --policy-name DeployPolicy \
  --policy-document @deploy-policy.json
```

**Deploy policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeTags",
        "ec2:DescribeImages"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::app-prod-*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/*"
    }
  ]
}
```

## EC2 Instance Role

**Type:** Service role for EC2 to access AWS services
**Permissions:** S3 read/write, Secrets Manager read, CloudWatch

```bash
# Create role
aws iam create-role --role-name ec2-instance-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Create instance profile
aws iam create-instance-profile --instance-profile-name ec2-instance-profile
aws iam add-role-to-instance-profile --instance-profile-name ec2-instance-profile \
  --role-name ec2-instance-role

# Attach policies
aws iam put-role-policy --role-name ec2-instance-role \
  --policy-name EC2Policy \
  --policy-document @ec2-policy.json
```

**EC2 policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::app-prod-bucket",
        "arn:aws:s3:::app-prod-bucket/*",
        "arn:aws:s3:::app-prod-backups",
        "arn:aws:s3:::app-prod-backups/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/app/prod/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

## MFA Setup

### User MFA

```bash
aws iam create-virtual-mfa-device \
  --virtual-mfa-device-name admin@example.com

# Scan QR code con Authenticator app (Google Auth, Authy, etc.)

aws iam enable-mfa-device \
  --user-name admin@example.com \
  --serial-number arn:aws:iam::ACCOUNT:mfa/admin@example.com \
  --authentication-code1 123456 \
  --authentication-code2 654321
```

### Root Account MFA

Via AWS Console → Security Credentials → Activate MFA

## Least Privilege Example

**Principio:** cada usuario/role tiene mínimos permisos para su trabajo.

```json
// Developer: solo read S3, no delete
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:ListBucket"],
  "Resource": ["arn:aws:s3:::app-*/*"]
}

// CI/CD: deploy específico role, no admin
{
  "Effect": "Allow",
  "Action": [
    "ec2:DescribeInstances",
    "ssm:SendCommand"
  ],
  "Resource": "arn:aws:ec2:us-east-1:ACCOUNT:instance/i-prodapi"
}
```

## Auditing

### CloudTrail

Ver quién hizo qué y cuándo:

```bash
# Enable CloudTrail
aws cloudtrail create-trail --name api-trail --s3-bucket-name api-cloudtrail-logs

# Query logs
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRole
```

## Troubleshooting

### "User: arn:aws:iam::... is not authorized to perform: ..."

Usuario no tiene permission. Verificar policy attached a user/role:

```bash
aws iam list-attached-user-policies --user-name admin@example.com
aws iam get-user-policy --user-name admin@example.com --policy-name POLICY_NAME
```

### "MFA device required"

Login requiere MFA:

```bash
aws sts get-session-token \
  --serial-number arn:aws:iam::ACCOUNT:mfa/admin@example.com \
  --token-code 123456

# Usa temp credentials devueltas
```

## Referencias

- AWS IAM best practices: https://docs.aws.amazon.com/iam/latest/userguide/best-practices.html
- OIDC federation: https://docs.aws.amazon.com/iam/latest/userguide/id_roles_create_for-idp_oidc.html
