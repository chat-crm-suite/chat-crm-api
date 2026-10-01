export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  DOCUMENT = 'document',
  // FILE = 'file',
  // AUDIO = 'audio',
  // VIDEO = 'video',
}

export enum MessageSenderType {
  AGENT = 'agent',
  CLIENT = 'client',
  SYSTEM = 'system'
  // 'user' eliminado: era redundante con 'agent' (operador logueado).
  // Filas legacy con senderType='user' en MySQL (enum nativo) se tratan como agent a nivel app.
}

export enum MessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  RECEIVED = 'received',
  READ = 'read',
  FAILED = 'failed'
}

export enum MessageDirection {
  IN = 'in',
  OUT = 'out'
}
