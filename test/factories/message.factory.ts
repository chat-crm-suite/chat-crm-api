import { Factory } from 'fishery';
import { faker } from '@faker-js/faker';
import { DataSource, EntityManager } from 'typeorm';
import {
  Message
} from '@modules/message/message.entity';
import {
  MessageSenderType,
  MessageType,
  MessageStatus,
  MessageDirection
} from "@modules/message/message.enum";

type MessageTransientParams = {
  manager?: DataSource | EntityManager;
};

export const MessageFactory = Factory.define<Message, MessageTransientParams>(
  ({ onCreate, associations, transientParams, params }) => {
    onCreate(async (message) => {
      const manager = transientParams.manager;
      if (manager) {
        const repository = manager.getRepository(Message);
        return await repository.save(message);
      }
      return message;
    });

    const message = new Message();
    // body == content con otro nombre: se mapea a content (única columna de texto).
    // waId/contact/agent NO van al mensaje: wa_* vive en whatsapp_message_details,
    // el externo es el chat via Contact y el operador se resuelve por senderType+senderId.
    message.senderType = params.senderType ?? MessageSenderType.AGENT;
    message.content = faker.lorem.sentence();
    message.type = MessageType.TEXT;
    message.mediaUrl = faker.internet.url();
    message.status = MessageStatus.SENT;
    message.direction = message.senderType == MessageSenderType.AGENT
      ? MessageDirection.IN
      : MessageDirection.OUT;

    // relations (solo las que existen en la entidad: chat + senderId polimórfico)
    message.chat = associations.chat;
    message.senderId = associations.senderId ?? faker.string.uuid();

    return message;
  }
);