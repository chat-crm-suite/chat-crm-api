import { WhatsAppPayload } from '../interfaces/whatsapp-message.interface';

export class SendWhatsAppMessageCommand {
  constructor(
    public readonly payload: WhatsAppPayload,
    public readonly companyId?: string,
  ) {}
}
