import { WhatsappNotificationError } from '@daweto/whatsapp-api-types';

export class FailWhatsAppMessageCommand {
  constructor(
    public readonly recipientId: string,
    public readonly err: WhatsappNotificationError,
    public readonly waId?: string,
  ) {}
}
