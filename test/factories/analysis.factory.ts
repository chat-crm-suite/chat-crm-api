import { faker } from '@faker-js/faker';
import { Factory } from 'fishery';

import { Analysis } from '@modules/analysis/entities/analysis.entity';
import { Company } from '@modules/company/entities/company.entity';
import { Conversation } from '@modules/conversations/entities/conversation.entity';
import { Message } from '@modules/message/entities/message.entity';

import { ConversationFactory } from './conversation.factory';
import { MessageFactory } from './message.factory';
import type { ManagerTransientParams } from './types';

type AnalysisTransientParams = ManagerTransientParams;

export const AnalysisFactory = Factory.define<Analysis, AnalysisTransientParams>(
  ({ associations, onCreate, params, transientParams }) => {
    onCreate(async (analysis) => {
      const manager = transientParams.manager;
      if (!manager) return analysis;

      if (analysis.message && !analysis.message.id) {
        analysis.message = await MessageFactory.transient({ manager }).create(
          analysis.message,
        );
      }

      if (analysis.message?.id) {
        analysis.messageId = analysis.message.id;
        if (!analysis.conversationId || !analysis.companyId) {
          const persisted = await manager
            .getRepository(Message)
            .findOne({ where: { id: analysis.message.id } });
          if (persisted) {
            analysis.message = persisted;
            analysis.conversationId = persisted.conversationId;
            analysis.companyId = persisted.companyId;
          }
        }
      }

      if (
        !analysis.conversationId &&
        analysis.conversation &&
        !analysis.conversation.id
      ) {
        analysis.conversation = await ConversationFactory.transient({
          manager,
        }).create(analysis.conversation);
      }
      if (analysis.conversation?.id) {
        analysis.conversationId = analysis.conversation.id;
        if (!analysis.companyId) {
          analysis.companyId = analysis.conversation.companyId;
        }
      }

      if (!analysis.conversationId) {
        // A header without conversation would violate the NOT NULL FK; create
        // the whole message/conversation/company chain.
        const message = await MessageFactory.transient({ manager }).create();
        analysis.message = message;
        analysis.messageId = message.id;
        analysis.conversationId = message.conversationId;
        analysis.companyId = message.companyId;
      } else if (!analysis.companyId) {
        const conversation = await manager
          .getRepository(Conversation)
          .findOne({ where: { id: analysis.conversationId } });
        if (conversation) analysis.companyId = conversation.companyId;
      }

      return manager.getRepository(Analysis).save(analysis);
    });

    const analysis = new Analysis();
    analysis.target = params.target ?? 'message';
    analysis.type = params.type ?? 'sentiment';
    analysis.status = params.status ?? 'completed';
    analysis.model = params.model ?? 'factory-model';
    analysis.label =
      params.label ??
      faker.helpers.arrayElement(['positive', 'neutral', 'negative']);
    analysis.confidence =
      params.confidence ??
      faker.number.float({ min: 0.5, max: 1, fractionDigits: 4 });
    analysis.result = params.result ?? { source: 'factory' };
    analysis.completedAt = params.completedAt ?? new Date();

    const company =
      associations.company ??
      (params.companyId ? ({ id: params.companyId } as Company) : undefined);

    const message =
      associations.message ??
      (params.message as Message | undefined) ??
      (params.messageId
        ? undefined
        : MessageFactory.build(
            undefined,
            company ? { associations: { company } } : undefined,
          ));
    if (message) {
      analysis.message = message;
      analysis.messageId = message.id;
      if (message.conversationId) {
        analysis.conversationId = message.conversationId;
      }
      if (message.companyId) analysis.companyId = message.companyId;
    }
    if (params.messageId) analysis.messageId = params.messageId;
    if (params.conversationId) analysis.conversationId = params.conversationId;
    if (params.companyId) analysis.companyId = params.companyId;

    if (associations.conversation) {
      analysis.conversation = associations.conversation;
      analysis.conversationId = associations.conversation.id;
      if (associations.conversation.companyId) {
        analysis.companyId = associations.conversation.companyId;
      }
    }

    return analysis;
  },
);
