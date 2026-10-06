// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { firstValueFrom, of, toArray } from 'rxjs';

import { AnalyzeMessageCommand } from '../analysis/sentiment/commands/analyze-message.command';
import { BroadcastConversationMessageCommand } from './commands/index';
import { MessageSavedEvent } from './events/message-saved.event';
import { ConversationSaga } from './conversation.saga';

describe('ConversationSaga', () => {
  it('emits each command (not an array) when a message is saved', async () => {
    const payload = { id: 'm1', conversationId: 'c1' };
    const saga = new ConversationSaga({
      getMessagePayload: jest.fn().mockResolvedValue(payload),
    } as never);
    const message = { id: 'm1', body: 'hi', conversationId: 'c1' };

    const commands = await firstValueFrom(
      saga
        .analyzeMessage(of(new MessageSavedEvent(message as never, 'co1')))
        .pipe(toArray()),
    );

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(AnalyzeMessageCommand);
    expect(commands[1]).toBeInstanceOf(BroadcastConversationMessageCommand);
  });
});
