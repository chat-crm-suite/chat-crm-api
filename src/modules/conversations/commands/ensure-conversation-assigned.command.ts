// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Command } from '@nestjs/cqrs';

import { AssignmentOutcome } from '../assignment/assignment.types';

/**
 * Asegura dueño para una conversación que acaba de recibir un mensaje de
 * cliente. Se dispara desde el saga de mensajes, nunca lanza hacia el flujo.
 */
export class EnsureConversationAssignedCommand extends Command<AssignmentOutcome> {
  constructor(
    public readonly conversationId: string,
    public readonly companyId?: string,
  ) {
    super();
  }
}
