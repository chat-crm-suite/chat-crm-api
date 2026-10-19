// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import type { InsertEvent } from 'typeorm';

import { Channel } from '../entities/channel.entity';
import { ChannelSubscriber } from './channel.subscriber';

describe('ChannelSubscriber', () => {
  const subscriber = new ChannelSubscriber();
  const insert = (entity: Partial<Channel>) =>
    ({ entity }) as unknown as InsertEvent<Channel>;

  it('listens to channels', () => {
    expect(subscriber.listenTo()).toBe(Channel);
  });

  it('generates a 64-hex verify token when the channel has none', () => {
    const event = insert({ type: 'whatsapp' });

    subscriber.beforeInsert(event);

    expect(event.entity.webhookVerifyToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives every channel its own token', () => {
    const first = insert({});
    const second = insert({});

    subscriber.beforeInsert(first);
    subscriber.beforeInsert(second);

    expect(first.entity.webhookVerifyToken).not.toBe(
      second.entity.webhookVerifyToken,
    );
  });

  it('keeps a token sent by the caller', () => {
    const event = insert({ webhookVerifyToken: 'chosen-token' });

    subscriber.beforeInsert(event);

    expect(event.entity.webhookVerifyToken).toBe('chosen-token');
  });
});
