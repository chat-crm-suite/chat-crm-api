import {
  WhatsappNotification as Notification,
  WhatsappNotificationChange as Change,
  WhatsappNotificationContact as Contact,
  WhatsappNotificationMessage as Message,
  WhatsappNotificationTextMessage as TextMessage,
  WhatsappNotificationImageMessage as ImageMessage,
  WhatsappNotificationDocumentMessage as DocumentMessage,
  WhatsappNotificationAudioMessage as AudioMessage,
  WhatsappNotificationVideoMessage as VideoMessage,
  WhatsappNotificationStickerMessage as StickerMessage,
  WhatsappNotificationButtonMessage as ButtonMessage,
  WhatsappNotificationError,
  WhatsappNotificationStatus,
} from '@daweto/whatsapp-api-types';
import {
  ContactPerson,
  InteractiveContent,
  LocationContent,
  MessageContent,
  MessageContext,
  ParsedMessage,
  ReactionContent,
} from '../types/whatsapp.types';

// --- Handlers ---

type Handler<T = Message> = (
  msg: T,
  ctx: MessageContext,
) => MessageContent | undefined;

const handlers: {
  text?: Handler<TextMessage>;
  image?: Handler<ImageMessage>;
  document?: Handler<DocumentMessage>;
  audio?: Handler<AudioMessage>;
  video?: Handler<VideoMessage>;
  sticker?: Handler<StickerMessage>;
  location?: Handler<{ location?: LocationContent['location'] }>;
  contacts?: Handler<{ contacts?: ContactPerson[] }>;
  interactive?: Handler<{ interactive?: InteractiveContent['interactive'] }>;
  reaction?: Handler<{ reaction?: ReactionContent['reaction'] }>;
  button?: Handler<ButtonMessage>;
} = {
  text: (msg) => ({ type: 'text', text: msg.text ?? { body: '' } }),
  image: (msg) => ({ type: 'image', image: msg.image }),
  document: (msg) => ({ type: 'document', document: msg.document }),
  audio: (msg) => ({ type: 'audio', audio: msg.audio }),
  video: (msg) => ({ type: 'video', video: msg.video }),
  sticker: (msg) => ({ type: 'sticker', sticker: msg.sticker }),
  location: (msg) => ({ type: 'location', location: msg.location }),
  contacts: (msg) => ({ type: 'contact', contacts: msg.contacts }),
  interactive: (msg) => ({ type: 'interactive', interactive: msg.interactive }),
  reaction: (msg) => ({ type: 'reaction', reaction: msg.reaction }),
  // Legacy template quick-reply click: same readable row as an interactive.
  button: (msg) => ({
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id: msg.button?.payload, title: msg.button?.text },
    },
  }),
};

// --- Mappers ---

const toContactMap = (contacts: Contact[]): Record<string, Contact> =>
  Object.fromEntries(contacts.map((c): [string, Contact] => [c.wa_id, c]));

const toMessage = (
  msg: Message,
  ctx: MessageContext,
): ParsedMessage | undefined => {
  let content: MessageContent | undefined;

  // Raw provider types beyond the SDK union (`contacts`, `location`,
  // `interactive`, `reaction`) are matched by string; each handler declares
  // the fragment it consumes.
  switch (msg.type as string) {
    case 'text':
      content = handlers.text?.(msg as TextMessage, ctx);
      break;
    case 'image':
      content = handlers.image?.(msg as ImageMessage, ctx);
      break;
    case 'document':
      content = handlers.document?.(msg as DocumentMessage, ctx);
      break;
    case 'audio':
      content = handlers.audio?.(msg as AudioMessage, ctx);
      break;
    case 'video':
      content = handlers.video?.(msg as VideoMessage, ctx);
      break;
    case 'sticker':
      content = handlers.sticker?.(msg as StickerMessage, ctx);
      break;
    case 'location':
      content = handlers.location?.(
        msg as unknown as { location?: LocationContent['location'] },
        ctx,
      );
      break;
    case 'contacts':
      content = handlers.contacts?.(
        msg as unknown as { contacts?: ContactPerson[] },
        ctx,
      );
      break;
    case 'interactive':
      content = handlers.interactive?.(
        msg as unknown as { interactive?: InteractiveContent['interactive'] },
        ctx,
      );
      break;
    case 'reaction':
      content = handlers.reaction?.(
        msg as unknown as { reaction?: ReactionContent['reaction'] },
        ctx,
      );
      break;
    case 'button':
      content = handlers.button?.(msg as ButtonMessage, ctx);
      break;
    default:
      return undefined;
  }

  if (!content) return undefined;
  return { context: ctx, content };
};

/**
 * Rehydrates a single message stored by the durable intake (T1) into the
 * pipeline shape. Replay never re-parses a webhook: the stored payload is the
 * source of truth.
 */
export const toParsedMessage = (
  message: unknown,
  phoneNumberId?: string | null,
  senderName?: string,
): ParsedMessage | undefined => {
  if (!isStoredMessage(message)) return undefined;

  const ctx: MessageContext = {
    phoneNumberId: phoneNumberId ?? '',
    from: message.from,
    messageId: message.id,
    senderName,
  };

  return toMessage(message, ctx);
};

const isStoredMessage = (value: unknown): value is Message => {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as { id?: unknown; from?: unknown };
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.from === 'string'
  );
};

const toMessages = ({ value }: Change): ParsedMessage[] => {
  const contacts = toContactMap(value.contacts ?? []);
  return (value.messages ?? []).flatMap((msg) => {
    const ctx: MessageContext = {
      phoneNumberId: value.metadata.phone_number_id,
      from: msg.from,
      messageId: msg.id,
      senderName: contacts[msg.from]?.profile?.name,
    };
    const parsed = toMessage(msg, ctx);
    return parsed ? [parsed] : [];
  });
};

export interface WebhookResult {
  messages: ParsedMessage[];
  statuses: WhatsappNotificationStatus[];
  errors: WhatsappNotificationError[];
}

export const mapWebhookToMessages = (body: Notification): WebhookResult => {
  if (body?.object !== 'whatsapp_business_account')
    return { messages: [], errors: [], statuses: [] };

  const changes = body.entry
    .flatMap(({ changes }) => changes)
    .filter(({ field }) => field === 'messages');

  const messages = changes
    .filter(({ value }) => value.messages?.length)
    .flatMap(toMessages);

  const statuses = changes.flatMap(({ value }) => value.statuses ?? []);

  const errors = changes
    .flatMap(({ value }) => value.statuses ?? [])
    .flatMap((status) => status?.errors ?? []);

  return { messages, statuses, errors };
};
