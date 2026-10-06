// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MessageType } from '../../../modules/message/domain/message.types';

export interface MessageContext {
  phoneNumberId: string; // Company Phone ID
  from: string;
  messageId: string;
  senderName?: string;
}

export interface TextContent {
  type: 'text';
  text: {
    body: string;
    preview_url?: boolean;
  };
}

export interface ImageContent {
  type: 'image';
  image?: {
    id?: string;
    caption?: string;
    sha256?: string;
    mime_type?: string;
  };
}

export interface DocumentContent {
  type: 'document';
  document?: {
    id: string;
    caption: string;
    filename: string;
    sha256: string;
    mime_type: string;
  };
}

export interface AudioContent {
  type: 'audio';
  audio?: {
    id: string;
    mime_type: string;
  };
}

export interface VideoContent {
  type: 'video';
  video?: {
    id: string;
    caption?: string;
    filename?: string;
    sha256?: string;
    mime_type?: string;
  };
}

export interface StickerContent {
  type: 'sticker';
  sticker?: {
    id: string;
    animated?: boolean;
    sha256?: string;
    mime_type?: string;
  };
}

export interface LocationContent {
  type: 'location';
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    url?: string;
  };
}

export interface ContactPerson {
  name?: {
    formatted_name?: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: Array<{ phone?: string; type?: string; wa_id?: string }>;
  emails?: Array<{ email?: string }>;
  org?: { company?: string };
}

export interface ContactContent {
  type: 'contact';
  contacts?: ContactPerson[];
}

export interface InteractiveContent {
  type: 'interactive';
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
}

export interface ReactionContent {
  type: 'reaction';
  reaction?: { message_id?: string; emoji?: string };
}

export interface WhatsAppMessageOptions {
  to: string;
  type: MessageType;
  text?: TextContent;
  image?: ImageContent;
  document?: DocumentContent;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | DocumentContent
  | AudioContent
  | VideoContent
  | StickerContent
  | LocationContent
  | ContactContent
  | InteractiveContent
  | ReactionContent;

export interface ParsedMessage {
  context: MessageContext;
  content: MessageContent;
}
