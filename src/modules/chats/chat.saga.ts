import { Injectable } from "@nestjs/common";
import { ICommand, ofType, Saga } from "@nestjs/cqrs";
import { filter, map, mergeMap, Observable } from "rxjs";
import { MessageSavedEvent } from "./events/message-saved.event";
import { MessageAnalyzedEvent } from "./events/message-analyzed.event";
import { ChatMessageSentEvent } from "./events/chat-message-sent.event";
import { getMessageStrategy } from "../message/strategies/strategy.registry";
import { MessageSenderType, MessageType } from "../message/message.enum";
import { AnalyzeMessageCommand } from "../analysis/sentiment/commands/analyze-message.command";
import {
  SaveChatMessageCommand,
  BroadcastChatMessageCommand,
  ClaimChatCommand,
  EnsureChatAssignedCommand,
  UpdateSentimentIndicatorCommand
} from "./commands/index";

@Injectable()
export class ChatSaga {
  @Saga()
  savedMessage = (event$: Observable<any>): Observable<ICommand> => {
    return event$.pipe(
      ofType(ChatMessageSentEvent),
      map((event) => new SaveChatMessageCommand(event.payload))
    )
  }

  @Saga()
  analyzeMessage = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageSavedEvent),
      mergeMap(({ message }) => [
        new AnalyzeMessageCommand(
          message.id,
          message.content,
          message?.chat?.id
        ),
        new BroadcastChatMessageCommand(
          message.id,
          getMessageStrategy(message.type ?? MessageType.TEXT).toBroadcastFields(message),
          message.chat?.id
        )
      ])
    );
  };

  /**
   * Asignación (Q1/Q13/Q15): un mensaje de cliente en un chat sin dueño dispara
   * la asignación automática; la respuesta de un agente reclama el chat.
   * Agnóstico del canal: todo pasa por el evento de mensaje guardado.
   */
  @Saga()
  assignChat = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageSavedEvent),
      map(({ message, companyId }) => {
        const chatId = message.chat?.id;
        if (!chatId) return null;

        if (message.senderType === MessageSenderType.CLIENT) {
          return new EnsureChatAssignedCommand(chatId, companyId);
        }
        if (message.senderType === MessageSenderType.AGENT) {
          return new ClaimChatCommand(chatId, message.senderId, companyId);
        }
        return null;
      }),
      filter(
        (command): command is EnsureChatAssignedCommand | ClaimChatCommand =>
          command !== null,
      )
    );
  };

  @Saga()
  updateSentiment = (events$: Observable<any>): Observable<ICommand> => {
    return events$.pipe(
      ofType(MessageAnalyzedEvent),
      map((event) => new UpdateSentimentIndicatorCommand(
        event.probabilities,
        event.chatId
      ))
    );
  };
}
