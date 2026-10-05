import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Company } from '@modules/company/entities/company.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { Customer } from '@modules/customers/entities/customer.entity';
import { Message } from '@modules/message/entities/message.entity';

import { CompanyFactory } from './company.factory';
import { CompanyMemberFactory } from './company-member.factory';
import { ConversationFactory } from './conversation.factory';
import { CustomerFactory } from './customer.factory';
import type { ManagerTransientParams } from './types';

type MessageTransientParams = ManagerTransientParams;

export const MessageFactory = Factory.define<Message, MessageTransientParams>(
  ({ associations, onCreate, params, transientParams }) => {
    onCreate(async (message) => {
      const manager = transientParams.manager;
      if (!manager) return message;

      if (message.conversation?.id) {
        // Reference to an existing conversation: re-read so company_id and the
        // relation match the persisted row (params may only carry the id).
        const persisted = await manager
          .getRepository(Conversation)
          .findOne({ where: { id: message.conversation.id } });
        if (persisted) {
          message.conversation = persisted;
          message.conversationId = persisted.id;
          message.company = { id: persisted.companyId } as Company;
          message.companyId = persisted.companyId;
        }
      } else if (message.conversation) {
        if (!message.conversation.company?.id && message.company?.id) {
          message.conversation.company = message.company;
          message.conversation.companyId = message.company.id;
        }
        message.conversation = await ConversationFactory.transient({
          manager,
        }).create(message.conversation);
        message.conversationId = message.conversation.id;
        message.company = { id: message.conversation.companyId } as Company;
        message.companyId = message.conversation.companyId;
      }

      if (message.senderMember && !message.senderMember.id) {
        message.senderMember = await CompanyMemberFactory.transient({
          manager,
        }).create(message.senderMember);
      }
      if (message.senderMember?.id) {
        message.senderMemberId = message.senderMember.id;
      }

      if (message.senderCustomer && !message.senderCustomer.id) {
        message.senderCustomer = await CustomerFactory.transient({
          manager,
        }).create(message.senderCustomer);
      }
      if (message.senderCustomer?.id) {
        message.senderCustomerId = message.senderCustomer.id;
      }

      return manager.getRepository(Message).save(message);
    });

    const senderType = params.senderType ?? 'customer';
    const direction =
      params.direction ?? (senderType === 'customer' ? 'inbound' : 'outbound');

    const message = new Message();
    message.direction = direction;
    message.senderType = senderType;
    message.type = params.type ?? 'text';
    message.body = params.body ?? faker.lorem.sentence();
    message.status =
      params.status ?? (direction === 'inbound' ? 'delivered' : 'sent');
    message.clientMessageId = params.clientMessageId;
    message.externalId = params.externalId;

    const company =
      associations.company ??
      (params.companyId ? ({ id: params.companyId } as Company) : undefined);

    const conversation =
      associations.conversation ??
      (params.conversationId
        ? ({ id: params.conversationId } as Conversation)
        : ConversationFactory.build(
            undefined,
            company ? { associations: { company } } : undefined,
          ));
    message.conversation = conversation;
    message.conversationId = conversation.id;

    message.company = company ?? conversation.company ?? CompanyFactory.build();
    message.companyId = message.company.id;

    if (associations.senderMember) {
      message.senderMember = associations.senderMember;
      message.senderMemberId = associations.senderMember.id;
    }
    if (params.senderMemberId) message.senderMemberId = params.senderMemberId;

    if (associations.senderCustomer) {
      message.senderCustomer = associations.senderCustomer;
      message.senderCustomerId = associations.senderCustomer.id;
    }
    if (params.senderCustomerId) {
      message.senderCustomerId = params.senderCustomerId;
    }

    return message;
  },
);
