// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { InboundMessageDiscardedEvent } from '../events/inbound-message-discarded.event';
import { InboundMediaEnrichedEvent } from '../events/inbound-media-enriched.event';
import { InboundMediaFailedEvent } from '../events/inbound-media-failed.event';
import {
  InboundDiscardLogHandler,
  InboundMediaEnrichedLogHandler,
  InboundMediaFailedLogHandler,
} from './inbound-log.handlers';

/**
 * Ticket #24: dedicated log consumers per domain fact. A discard warns once
 * with its correlation ids (message id, type, reason); enriched media debugs
 * with message, attachment and media ids; failed media logs at error or warn
 * depending on retryability. None of them may ever throw into the event bus.
 */
const logger = () => ({
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  setContext: jest.fn(),
});

describe('Inbound discard log handler (ticket #24)', () => {
  it('warns once with the correlated message id, type and reason', () => {
    const log = logger();
    const handler = new InboundDiscardLogHandler(log as never);

    handler.handle(
      new InboundMessageDiscardedEvent('wamid-1', 'order', 'unknown-type'),
    );

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'wamid-1',
        type: 'order',
        reason: 'unknown-type',
      }),
      expect.any(String),
    );
  });

  it('never throws when the log sink fails', () => {
    const log = logger();
    log.warn.mockImplementation(() => {
      throw new Error('log sink down');
    });
    const handler = new InboundDiscardLogHandler(log as never);

    expect(() =>
      handler.handle(
        new InboundMessageDiscardedEvent('wamid-1', 'text', 'invalid-message'),
      ),
    ).not.toThrow();
  });
});

describe('Inbound media enriched log handler (ticket #24)', () => {
  it('debugs with message, attachment and media ids', () => {
    const log = logger();
    const handler = new InboundMediaEnrichedLogHandler(log as never);

    handler.handle(
      new InboundMediaEnrichedEvent({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
      }),
    );

    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
      }),
      expect.any(String),
    );
  });

  it('never throws when the log sink fails', () => {
    const log = logger();
    log.debug.mockImplementation(() => {
      throw new Error('log sink down');
    });
    const handler = new InboundMediaEnrichedLogHandler(log as never);

    expect(() =>
      handler.handle(
        new InboundMediaEnrichedEvent({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
      }),
      ),
    ).not.toThrow();
  });
});

describe('Inbound media failed log handler (ticket #24)', () => {
  it('warns when the fault was retryable (retries exhausted)', () => {
    const log = logger();
    const handler = new InboundMediaFailedLogHandler(log as never);

    handler.handle(
      new InboundMediaFailedEvent(
        {
          messageId: 'msg-1',
          attachmentId: 'att-1',
          mediaId: 'media-1',
          type: 'video',
        },
        true,
        new Error('graph 500'),
      ),
    );

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'video',
        retryable: true,
      }),
      expect.any(String),
    );
  });

  it('logs at error when the fault is terminal', () => {
    const log = logger();
    const handler = new InboundMediaFailedLogHandler(log as never);

    handler.handle(
      new InboundMediaFailedEvent(
        {
          messageId: 'msg-1',
          attachmentId: 'att-1',
          mediaId: 'media-1',
          type: 'image',
        },
        false,
        new Error('media too large'),
      ),
    );

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        attachmentId: 'att-1',
        mediaId: 'media-1',
        type: 'image',
        retryable: false,
      }),
      expect.any(String),
    );
  });

  it('never throws when the log sink fails', () => {
    const log = logger();
    log.error.mockImplementation(() => {
      throw new Error('log sink down');
    });
    const handler = new InboundMediaFailedLogHandler(log as never);

    expect(() =>
      handler.handle(
        new InboundMediaFailedEvent(
          {
            messageId: 'msg-1',
            attachmentId: 'att-1',
            mediaId: 'media-1',
            type: 'image',
          },
          false,
          new Error('boom'),
        ),
      ),
    ).not.toThrow();
  });
});
