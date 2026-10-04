export enum ChatStatus {
  OPEN = 'open',
  PENDING = 'pending',
  CLOSED = 'closed',
  ARCHIVED = 'archived',
}
export enum ChatPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}
export enum ChatChannel {
  WHATSAPP = 'whatsapp',
  TELEGRAM = 'telegram',
  MESSENGER = 'messenger',
  SMS = 'sms',
  EMAIL = 'email'
}

export enum ReasonAssignment {
  TRANSFER = 'transfer',
  ESCALATION = 'escalation',
  MANUAL = 'manual',
  AUTO = 'auto',
}

export enum ChatGatewayEvent {
  Join = 'chat:join',
  Joined = 'chat:joined',
  BroadcastMessage = 'chat:message:broadcast',
  ErrorMessage = 'chat:message:error',
  SendMessage = 'chat:message:send',
  ReceivedMessage = 'chat:message:received',
  UpdateSentimentIndicator = 'chat:sentiment:update',
  /** Evento que ya escucha el frontend (socket-provider) para notificaciones. */
  NewNotification = 'new-notification',
  ChatAssigned = 'chat:assigned',
  ChatUnassigned = 'chat:unassigned',
}
