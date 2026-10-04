/**
 * Chat enums live in the shared contracts (`src/contracts/chat.contract.ts`).
 * Re-exported here so `ChatStatus.OPEN`-style usage keeps working across the API.
 */
export {
  ChatStatus,
  ChatPriority,
  ChatChannel,
  ReasonAssignment,
  ChatSocketEvent as ChatGatewayEvent,
} from '../../contracts/index';

export type {
  ChatStatus as ChatStatusType,
  ChatPriority as ChatPriorityType,
  ChatChannel as ChatChannelType,
  ReasonAssignment as ReasonAssignmentType,
} from '../../contracts/index';
