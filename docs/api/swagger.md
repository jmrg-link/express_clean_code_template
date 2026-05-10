# Swagger / OpenAPI

> How Swagger is generated and JSDoc convention for documenting endpoints.

## Setup

**Ubicación:** `src/config/swagger.ts`

```typescript
import swaggerJsDoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express Clean Backend API',
      version: '4.0.0',
      description: 'Hexagonal + DDD-lite con Keycloak + Mongo + S3'
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development'
      },
      {
        url: 'https://staging.api.example.com',
        description: 'Staging'
      },
      {
        url: 'https://api.example.com',
        description: 'Production'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['src/presentation/**/*.ts']
};

export const swaggerSpec = swaggerJsDoc(options);
```

**Uso en Express:**

```typescript
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '#config/swagger';

app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/v1/spec', (req, res) => res.json(swaggerSpec));
```

## JSDoc Convention

### Patrón general

```typescript
/**
 * @swagger
 * /api/v1/endpoint:
 *   post:
 *     summary: Resumen corto
 *     description: |
 *       Descripción detallada.
 *       Puede ser multilínea.
 *     tags: [Feature]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DtoName'
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResponseDto'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
```

### Ejemplo: POST /auth/login

```typescript
/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Autenticar usuario
 *     description: |
 *       Valida email + password contra Keycloak.
 *       Retorna access token + refresh token + user profile.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                   example: 200
 *                 tokens:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                 user:
 *                   $ref: '#/components/schemas/UserDto'
 *       400:
 *         description: Validation error (Zod)
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Rate limit exceeded (10 requests per 15 minutes)
 */
router.post('/login', validate(LoginDto), authController.login);
```

### Componentes reutilizables

```typescript
/**
 * @swagger
 * components:
 *   schemas:
 *     UserDto:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: 507f1f77bcf86cd799439011
 *         email:
 *           type: string
 *           format: email
 *         keycloak_id:
 *           type: string
 *         roles:
 *           type: array
 *           items:
 *             type: string
 *             enum: [admin, user]
 *         createdAt:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - email
 *         - keycloak_id
 */
```

### Tags (agrupa endpoints)

```typescript
/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Autenticación y autorización
 *   - name: Users
 *     description: Gestión de usuarios
 *   - name: Storage
 *     description: Almacenamiento de archivos
 */
```

## Best Practices

| Práctica | Razón |
|---|---|
| **Describe todos los códigos HTTP** | 200, 400, 401, 403, 404, 409, 429, 500 |
| **Multilínea descriptions** | `\|` para markdown |
| **Reutiliza esquemas** | `$ref: '#/components/schemas/...'` |
| **Especifica security** | `security: [{bearerAuth: []}]` para endpoints protegidos |
| **Ejemplos reales** | `example: "value"` en properties |
| **Tipo explícito** | Siempre `type`, `format`, `enum` |

## Validación

```bash
# Verificar Swagger JSON es válido
curl http://localhost:3000/api/v1/spec | jq .

# Ver en Swagger Editor
open https://editor.swagger.io
# Paste JSON
```

## Acceso

```
http://localhost:3000/api/v1/docs    # Swagger UI
http://localhost:3000/api/v1/spec    # OpenAPI JSON
```

## Referencias

- swagger-jsdoc docs: https://github.com/Surnet/swagger-jsdoc
- OpenAPI 3.0 spec: https://spec.openapis.org/oas/v3.0.3
