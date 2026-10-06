import { QueryFailedError } from 'typeorm';

interface DriverError {
  code?: string;
  errno?: number;
}

/**
 * MySQL unique-index violation (1062) or sqlite UNIQUE constraint. The driver
 * may wrap the error (`QueryFailedError` exposes the original as
 * `driverError`) or not, so both shapes are checked.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const candidate = error as DriverError & { driverError?: DriverError };

  if (
    candidate?.code === 'ER_DUP_ENTRY' ||
    candidate?.errno === 1062 ||
    candidate?.driverError?.code === 'ER_DUP_ENTRY' ||
    candidate?.driverError?.errno === 1062
  ) {
    return true;
  }

  return (
    error instanceof QueryFailedError &&
    /UNIQUE constraint failed/i.test(error.message)
  );
}

/** InnoDB chose this transaction as the deadlock victim: safe to retry. */
export function isDeadlockError(error: unknown): boolean {
  const candidate = error as DriverError & { driverError?: DriverError };

  return (
    candidate?.code === 'ER_LOCK_DEADLOCK' ||
    candidate?.errno === 1213 ||
    candidate?.driverError?.code === 'ER_LOCK_DEADLOCK' ||
    candidate?.driverError?.errno === 1213
  );
}
