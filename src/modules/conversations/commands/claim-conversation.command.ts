import { Command } from '@nestjs/cqrs';

import { AssignmentOutcome } from '../assignment/assignment.types';

/**
 * Reclamo implícito: responder una conversación libre la asigna al member que
 * responde. Conflicto con otro dueño es un no-op silencioso.
 */
export class ClaimConversationCommand extends Command<AssignmentOutcome> {
  constructor(
    public readonly conversationId: string,
    public readonly memberId: string,
    public readonly companyId?: string,
  ) {
    super();
  }
}
