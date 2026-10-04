/**
 * Shared API contracts (Zod schemas + inferred types).
 *
 * Single source of truth for request/response payloads:
 * - API imports them with a relative path and wraps them with `createZodDto`.
 * - Frontend resolves `@chat-crm/contracts` to this folder (Vite/TS alias).
 *
 * Rules:
 * - Only `zod` imports allowed here (must stay framework-free).
 * - Request schemas describe what the API accepts; UI-only strictness
 *   (empty-string placeholders, min lengths for typing) belongs to the app.
 * - Response schemas are also used by `@ZodResponse` to serialize endpoints.
 */
export * from './auth.contract';
export * from './chat.contract';
export * from './chats.contract';
export * from './company.contract';
export * from './contact.contract';
export * from './message.contract';
export * from './metrics.contract';
export * from './pagination.contract';
export * from './setup.contract';
export * from './user.contract';
export * from './whatsapp-config.contract';
export * from './whatsapp-webhook.contract';
