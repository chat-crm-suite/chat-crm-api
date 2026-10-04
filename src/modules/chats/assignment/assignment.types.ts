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
  agentId: string;
  /** Chats abiertos con asignación activa (Q8). */
  load: number;
  /** Última vez que se le asignó un chat; null = nunca (desempate Q2). */
  lastAssignedAt: Date | null;
}

export interface AssignmentSettings {
  autoAssignEnabled: boolean;
  /** Tope de chats concurrentes; <= 0 = sin tope. */
  maxChats: number;
  sticky: boolean;
}
