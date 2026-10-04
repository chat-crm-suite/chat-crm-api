import { Command } from '@nestjs/cqrs';
import { AssignmentOutcome } from '../assignment/assignment.types';

/**
 * Asegura dueño para un chat que acaba de recibir un mensaje de cliente.
 * Se dispara desde el saga de mensajes (Q1/Q15), nunca lanza hacia el flujo.
 */
export class EnsureChatAssignedCommand extends Command<AssignmentOutcome> {
  constructor(
    public readonly chatId: string,
    public readonly companyId?: string,
  ) {
    super();
  }
}
