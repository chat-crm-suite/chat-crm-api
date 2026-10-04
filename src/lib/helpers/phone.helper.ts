import { QueryFailedError } from 'typeorm';

type DriverErrorWithCode = { code?: string };

/**
 * Normaliza un teléfono de WhatsApp a formato `+<dígitos>`.
 * WhatsApp envía `from` como solo dígitos (ej. `51922936950`),
 * pero históricamente se guardó con `+` antepuesto en algunos paths.
 * Sin esto, el `find` no encuentra el contacto y el `save` choca
 * con el índice único (`phoneNumber`, `company`).
 */
export function normalizePhoneNumber(raw: string): string {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  return `+${digits}`;
}

/**
 * Detecta violación de unicidad en MySQL / Postgres / SQLite.
 * MySQL: `ER_DUP_ENTRY` (errno 1062) — es el del crash reportado.
 */
export function isDuplicateEntryError(error: unknown): boolean {
  const queryError = error as Partial<QueryFailedError> & DriverErrorWithCode & {
    driverError?: DriverErrorWithCode;
  };
  const code: unknown = queryError?.code ?? queryError?.driverError?.code;
  return (
    code === 'ER_DUP_ENTRY' || code === '23505' || code === 'SQLITE_CONSTRAINT'
  );
}
