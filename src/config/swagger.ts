import swaggerJsdoc from 'swagger-jsdoc';
import { env } from '#config/env';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express Clean Backend',
      version: '2.0.0',
      description:
        'API REST con Hexagonal DDD, Keycloak (jose), CQRS-lite repositories, Facade per feature.',
      contact: { name: 'API Maintainer', url: 'https://example.com' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: `http://localhost:${env.server.port}${env.server.apiPrefix}/${env.server.apiVersion}`, description: 'Dev' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT (Keycloak RS256 / HS256 fallback dev)',
        },
      },
      schemas: {
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            count: { type: 'integer' },
            totalPages: { type: 'integer' },
            nextPage: { type: 'boolean' },
            previousPage: { type: 'boolean' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/presentation/**/*.router.ts', './dist/presentation/**/*.router.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
