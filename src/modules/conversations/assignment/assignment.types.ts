/**
 * Desenlace de un intento de asignación. Lo consumen comandos, saga y
 * controllers para mapear a respuestas HTTP sin lanzar errores en el pipeline
 * de mensajes (el saga nunca debe romper por una asignación).
 */
export enum AssignmentOutcome {
  ASSIGNED = 'assigned',
  ALREADY_ASSIGNED = 'already-assigned',
  NO_CANDIDATES = 'no-candidates',
  DISABLED = 'disabled',
  CONFLICT = 'conflict',
  SKIPPED = 'skipped',
}

export interface AssignmentCandidate {
  /** `company_members.id` (v2: la asignación apunta al member, no al user). */
  memberId: string;
  /** Conversaciones abiertas con asignación activa. */
  load: number;
  /** Última vez que se le asignó una conversación; null = nunca. */
  lastAssignedAt: Date | null;
}

export interface AssignmentSettings {
  autoAssignEnabled: boolean;
  /** Tope de conversaciones concurrentes; <= 0 = sin tope. */
  maxOpen: number;
  sticky: boolean;
}
