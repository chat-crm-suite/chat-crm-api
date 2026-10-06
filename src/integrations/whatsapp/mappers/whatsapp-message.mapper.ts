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
  WhatsappNotificationError,
  WhatsappNotificationStatus,
  WhatsappNotificationMessageType as MessageType,
} from '@daweto/whatsapp-api-types';
import {
  ContactContent,
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
};

// --- Mappers ---

const toContactMap = (contacts: Contact[]): Record<string, Contact> =>
  Object.fromEntries(contacts.map((c): [string, Contact] => [c.wa_id, c]));

const toMessage = (
  msg: Message,
  ctx: MessageContext,
): ParsedMessage | undefined => {
  let content: MessageContent | undefined;

  switch (msg.type) {
    case 'text' as MessageType.Text:
      content = handlers.text?.(msg, ctx);
      break;
    case 'image' as MessageType.Image:
      content = handlers.image?.(msg, ctx);
      break;
    case 'document' as MessageType.Document:
      content = handlers.document?.(msg, ctx);
      break;
    case 'audio' as MessageType.Audio:
      content = handlers.audio?.(msg as AudioMessage, ctx);
      break;
    case 'video' as MessageType.Video:
      content = handlers.video?.(msg as VideoMessage, ctx);
      break;
    case 'sticker' as MessageType.Sticker:
      content = handlers.sticker?.(msg as StickerMessage, ctx);
      break;
    case 'location' as MessageType.Location:
      content = handlers.location?.(msg, ctx);
      break;
    case 'contacts' as unknown as MessageType:
      content = handlers.contacts?.(msg, ctx);
      break;
    case 'interactive' as MessageType.Interactive:
      content = handlers.interactive?.(msg, ctx);
      break;
    case 'reaction' as MessageType.Reaction:
      content = handlers.reaction?.(msg, ctx);
      break;
    default:
      return undefined;
  }

  if (!content) return undefined;
  return { context: ctx, content };
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
