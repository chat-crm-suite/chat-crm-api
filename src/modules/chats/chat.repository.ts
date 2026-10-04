import { Injectable } from '@nestjs/common';
import { DataSource, Like } from 'typeorm';
import { Chat, ChatAssignments } from './entities/index';
import { MessageContext } from '../../integrations/whatsapp/types/whatsapp.types';
import { Contact } from '../../entities/index';
import {
  isDuplicateEntryError,
  normalizePhoneNumber,
} from '../../lib/helpers/phone.helper';

@Injectable()
export class ChatRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findChatByPhone(phone: string) {
    const repo = this.dataSource.getRepository(Chat);
    return repo.findOne({
      where: {
        client: {
          phoneNumber: Like(`%${phone}%`),
        },
      },
      cache: true,
    });
  }

  /**
   * This is a method for whatsapp module
   * @param context WhatsApp message context info
   * @param companyId Empresa del config de WhatsApp, para aislar contactos por
   *   empresa (Q4) y asignar el chat al pool correcto.
   * @returns Chat Entity
   */
  async findOrCreateChatByPhone(context: MessageContext, companyId?: string) {
    const contactRepo = this.dataSource.getRepository(Contact);
    const chatRepo = this.dataSource.getRepository(Chat);
    const phoneNumber = normalizePhoneNumber(context.from);

    const findClient = () =>
      contactRepo.findOne({
        where: {
          phoneNumber,
          ...(companyId ? { company: { id: companyId } } : {}),
        },
      });

    let client = await findClient();

    if (!client) {
      try {
        client = await contactRepo.save(
          contactRepo.create({
            phoneNumber,
            username: context.senderName,
            ...(companyId ? { company: { id: companyId } } : {}),
          }),
        );
      } catch (error) {
        // Carrera o reintento de WhatsApp: otro worker/proceso ya insertó
        // el mismo (phoneNumber, company). Re-leer en vez de tumbar el server.
        if (!isDuplicateEntryError(error)) throw error;
        client = await findClient();
        if (!client) throw error;
      }
    }

    let chat = await chatRepo.findOne({
      where: {
        client: { id: client.id },
      },
      relations: ['client'],
    });

    if (!chat) {
      chat = chatRepo.create({
        client,
      });
      await chatRepo.save(chat);
    }

    return chat;
  }

  /**
   * Finds all agent assignments linked to a given chat.
   *
   * @param chatId - Unique identifier of the chat (foreign key in ChatAssignments).
   * @returns Promise resolving to an array of raw objects containing agent IDs.
   */
  findAssigments(chatId: string) {
    return this.dataSource
      .getRepository(ChatAssignments)
      .createQueryBuilder('assignment')
      .leftJoin('assignment.agent', 'agent')
      .select('agent.id', 'id')
      .where('assignment.chat_id = :chatId', { chatId })
      .getRawMany<{ id: string }>();
  }

  async listChatsAssignments(agentId: string) {
    const query: {
      chatId: string;
      chatStatus: string;
      messageId: string;
      messageContent: string;
      messageCreated: string;
      clientId: string;
      clientUsername: string;
      clientPhone: string;
      clientProfile: string;
    }[] = await this.dataSource.sql`
      SELECT
          ch.id AS chatId,
          ch.status AS chatStatus,
          ch.last_message_id AS messageId,
          me.content AS messageContent,
          ch.last_message_at AS messageCreated,
          co.id AS clientId,
          co.username AS clientUsername,
          co.phone_number AS clientPhone,
          co.profile AS clientProfile
      FROM
          chats ch
      LEFT JOIN chat_assignments ch_a ON
          ch.id = ch_a.chat_id
      LEFT JOIN messages me ON
          me.message_id = ch.last_message_id
      LEFT JOIN contacts co ON
          co.id = ch.client_id
      WHERE
          ch_a.agent_id = ${agentId}
          AND ch_a.unassigned_at IS NULL
          AND ch.status NOT IN('closed', 'archived')
    `;

    return query;
  }
}
