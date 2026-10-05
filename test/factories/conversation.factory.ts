import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Channel } from '@modules/channels/entities/channel.entity';
import { Company } from '@modules/company/entities/company.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { Customer } from '@modules/customers/entities/customer.entity';

import { ChannelFactory } from './channel.factory';
import { CompanyFactory } from './company.factory';
import { CompanyMemberFactory } from './company-member.factory';
import { CustomerFactory } from './customer.factory';
import type { ManagerTransientParams } from './types';

type ConversationTransientParams = ManagerTransientParams;

export const ConversationFactory = Factory.define<
  Conversation,
  ConversationTransientParams
>(({ associations, onCreate, params, transientParams }) => {
  onCreate(async (conversation) => {
    const manager = transientParams.manager;
    if (!manager) return conversation;

    if (conversation.company && !conversation.company.id) {
      conversation.company = await CompanyFactory.transient({ manager }).create(
        conversation.company,
      );
    }
    if (conversation.company?.id) conversation.companyId = conversation.company.id;

    if (conversation.channel && !conversation.channel.id) {
      if (!conversation.channel.company?.id && conversation.company) {
        conversation.channel.company = conversation.company;
        conversation.channel.companyId = conversation.company.id;
      }
      conversation.channel = await ChannelFactory.transient({ manager }).create(
        conversation.channel,
      );
    }
    if (conversation.channel?.id) conversation.channelId = conversation.channel.id;

    if (conversation.customer && !conversation.customer.id) {
      if (!conversation.customer.company?.id && conversation.company) {
        conversation.customer.company = conversation.company;
        conversation.customer.companyId = conversation.company.id;
      }
      conversation.customer = await CustomerFactory.transient({ manager }).create(
        conversation.customer,
      );
    }
    if (conversation.customer?.id) {
      conversation.customerId = conversation.customer.id;
    }

    if (conversation.assignedMember && !conversation.assignedMember.id) {
      conversation.assignedMember = await CompanyMemberFactory.transient({
        manager,
      }).create(conversation.assignedMember);
    }
    if (conversation.assignedMember?.id) {
      conversation.assignedMemberId = conversation.assignedMember.id;
    }

    return manager.getRepository(Conversation).save(conversation);
  });

  const conversation = new Conversation();
  conversation.status = params.status ?? 'open';
  conversation.priority = params.priority ?? 'low';
  conversation.lastMessageAt =
    params.lastMessageAt ?? faker.date.recent({ days: 7 });
  conversation.lastInboundAt = params.lastInboundAt;
  conversation.lastOutboundAt = params.lastOutboundAt;

  const company =
    associations.company ??
    (params.companyId
      ? ({ id: params.companyId } as Company)
      : CompanyFactory.build());
  conversation.company = company;
  conversation.companyId = company.id;

  const channel =
    associations.channel ??
    (params.channelId
      ? ({ id: params.channelId } as Channel)
      : ChannelFactory.build(undefined, { associations: { company } }));
  conversation.channel = channel;
  conversation.channelId = channel.id;

  const customer =
    associations.customer ??
    (params.customerId
      ? ({ id: params.customerId } as Customer)
      : CustomerFactory.build(undefined, { associations: { company } }));
  conversation.customer = customer;
  conversation.customerId = customer.id;

  if (associations.assignedMember) {
    conversation.assignedMember = associations.assignedMember;
    conversation.assignedMemberId = associations.assignedMember.id;
  }
  if (params.assignedMemberId) {
    conversation.assignedMemberId = params.assignedMemberId;
  }

  return conversation;
});
