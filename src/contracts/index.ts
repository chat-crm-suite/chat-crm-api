/**
 * Shared API contracts (Zod schemas + inferred types).
 *
 * Single source of truth for request/response payloads and domain values:
 * - API imports them with a relative path and wraps them with `createZodDto`.
 * - Frontend resolves `@chat-crm/contracts` to this folder (Vite/TS alias).
 *
 * Rules:
 * - Only `zod` imports allowed here (must stay framework-free).
 * - Request schemas describe what the API accepts; UI-only strictness
 *   (empty-string placeholders, min lengths for typing) belongs to the app.
 * - Response schemas are also used by `@ZodResponse` to serialize endpoints.
 */
export * from './analysis.contract';
export * from './auth.contract';
export * from './channel.contract';
export * from './company.contract';
export * from './conversation.contract';
export * from './customer.contract';
export * from './member.contract';
export * from './message.contract';
export * from './metrics.contract';
export * from './pagination.contract';
export * from './setup.contract';
export * from './template.contract';
export * from './user.contract';
export * from './whatsapp-webhook.contract';
