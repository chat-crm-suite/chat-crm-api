import { Injectable } from '@nestjs/common';
import { ICommand, ofType, Saga } from '@nestjs/cqrs';
import { filter, map, mergeMap, Observable } from 'rxjs';

import { AnalyzeMessageCommand } from '../analysis/sentiment/commands/analyze-message.command';
import { MessageAnalyzedEvent } from '../analysis/events/message-analyzed.event';
import { getMessageStrategy } from '../message/strategies/strategy.registry';
import {
  BroadcastConversationMessageCommand,
  ClaimConversationCommand,
  EnsureConversationAssignedCommand,
  SaveConversationMessageCommand,
  UpdateSentimentIndicatorCommand,
} from './commands/index';
import { ConversationMessageSentEvent } from './events/conversation-message-sent.event';
import { MessageSavedEvent } from './events/message-saved.event';

@Injectable()
export class ConversationSaga {
  @Saga()
  savedMessage = (event$: Observable<any>): Observable<ICommand> => {
    return event$.pipe(
      ofType(ConversationMessageSentEvent),
      map((event) => new SaveConversationMessageCommand(event.payload)),
    );
  };

  @Saga()
  analyzeMessage = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageSavedEvent),
      mergeMap(({ message }) => [
        new AnalyzeMessageCommand(
          message.id,
          message.body,
          message.conversationId,
        ),
        new BroadcastConversationMessageCommand(
          message.id,
          getMessageStrategy(message.type).toBroadcastFields(message),
          message.conversationId,
        ),
      ]),
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
          return new EnsureConversationAssignedCommand(conversationId, companyId);
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
          | EnsureConversationAssignedCommand
          | ClaimConversationCommand => command !== null,
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
