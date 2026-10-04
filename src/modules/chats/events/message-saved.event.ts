import { Message } from "../../../entities/index";

export class MessageSavedEvent {
  constructor(
    public readonly message: Message,
    /** Empresa del origen del mensaje (WhatsApp config o socket), si se conoce. */
    public readonly companyId?: string,
  ) { }
}