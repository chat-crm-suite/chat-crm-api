/**
 * Stub de test para `@nestjs/mapped-types`.
 *
 * La versión instalada (v12) publica ESM y Jest (CJS) no puede requerirla en
 * este entorno. Los e2e de setup no dependen de la validación derivada de esos
 * DTOs, así que se mapea a estas factorías mínimas (misma firma, sin copiar
 * decoradores).
 */
export const PartialType = (classRef: unknown) => classRef;
export const PickType = (classRef: unknown) => classRef;
export const OmitType = (classRef: unknown) => classRef;
export const IntersectionType = (...classRefs: unknown[]) => classRefs[0];
