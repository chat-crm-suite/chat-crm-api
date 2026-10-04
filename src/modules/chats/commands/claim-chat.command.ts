import { Command } from '@nestjs/cqrs';
import { AssignmentOutcome } from '../assignment/assignment.types';

/**
 * Reclamo implícito: responder un chat libre lo asigna al agente (Q13).
 * Conflicto con otro dueño es un no-op silencioso (Q9).
 */
export class ClaimChatCommand extends Command<AssignmentOutcome> {
  constructor(
    public readonly chatId: string,
    public readonly agentId: string,
    public readonly companyId?: string,
  ) {
    super();
  }
}
