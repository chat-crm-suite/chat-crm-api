// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { ICommand, ofType, Saga } from '@nestjs/cqrs';
import { filter, map, mergeMap, Observable } from 'rxjs';

import { AnalyzeMessageCommand } from '../analysis/sentiment/commands/analyze-message.command';
import { MessageAnalyzedEvent } from '../analysis/events/message-analyzed.event';
import { MessageService } from '../message/message.service';
import { toConversationMessagePayload } from '../message/mappers/conversation-message.mapper';
import {
  BroadcastConversationMessageCommand,
  ClaimConversationCommand,
  EnsureConversationAssignedCommand,
  UpdateSentimentIndicatorCommand,
} from './commands/index';
import { MessageSavedEvent } from './events/message-saved.event';

@Injectable()
export class ConversationSaga {
  constructor(private readonly messages: MessageService) {}

  @Saga()
  analyzeMessage = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageSavedEvent),
      // The saved entity has no attachments loaded: reload the payload so
      // live broadcasts carry the same `mediaUrl` as the REST history.
      mergeMap(async ({ message }) => [
        new AnalyzeMessageCommand(
          message.id,
          message.body,
          message.conversationId,
        ),
        new BroadcastConversationMessageCommand(
          message.id,
          (await this.messages.getMessagePayload(message.id)) ??
            toConversationMessagePayload(message, []),
          message.conversationId,
        ),
      ]),
      // An async mapper emits ONE array; the saga stream must emit each
      // command, otherwise `commandBus.execute([...])` finds no handler.
      mergeMap((commands) => commands),
    );
  };

  /**
   * Asignación: un mensaje de cliente en una conversación sin dueño dispara la
   * asignación automática; la respuesta de un member reclama la conversación.
   * Agnóstico del canal: todo pasa por el evento de mensaje guardado.
   */
  @Saga()
  assignConversation = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageSavedEvent),
      map(({ message, companyId }) => {
        const conversationId = message.conversationId;
        if (!conversationId) return null;

        if (message.senderType === 'customer') {
          return new EnsureConversationAssignedCommand(
            conversationId,
            companyId,
          );
        }
        if (message.senderType === 'member' && message.senderMemberId) {
          return new ClaimConversationCommand(
            conversationId,
            message.senderMemberId,
            companyId,
          );
        }
        return null;
      }),
      filter(
        (
          command,
        ): command is
          EnsureConversationAssignedCommand | ClaimConversationCommand =>
          command !== null,
      ),
    );
  };

  @Saga()
  updateSentiment = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageAnalyzedEvent),
      map(
        (event) =>
          new UpdateSentimentIndicatorCommand(
            event.probabilities,
            event.conversationId,
          ),
      ),
    );
  };
}
