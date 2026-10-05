import type { MessageType } from '../../../contracts/index';
import { DocumentMessageStrategy } from './document.strategy';
import { ImageMessageStrategy } from './image.strategy';
import type { MessageStrategy } from './message.strategy';
import { TextMessageStrategy } from './text.strategy';

/**
 * Only the persisted types with a dedicated payload builder. Types without a
 * strategy fall back to the generic conversation mapper.
 */
export const MESSAGE_STRATEGY_REGISTRY: Partial<
  Record<MessageType, MessageStrategy>
> = {
  text: new TextMessageStrategy(),
  image: new ImageMessageStrategy(),
  document: new DocumentMessageStrategy(),
};

export function getMessageStrategy(type: MessageType): MessageStrategy {
  const strategy = MESSAGE_STRATEGY_REGISTRY[type];

  if (!strategy) {
    throw new Error(`No strategy registered for message type: ${type}`);
  }

  return strategy;
}
