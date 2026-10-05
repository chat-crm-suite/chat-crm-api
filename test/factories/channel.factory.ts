import { Factory } from 'fishery';

import { Channel } from '@modules/channels/entities/channel.entity';

import { CompanyFactory } from './company.factory';
import type { ManagerTransientParams } from './types';

type ChannelTransientParams = ManagerTransientParams;

export const ChannelFactory = Factory.define<Channel, ChannelTransientParams>(
  ({ associations, onCreate, params, sequence, transientParams }) => {
    onCreate(async (channel) => {
      const manager = transientParams.manager;
      if (!manager) return channel;

      if (channel.company && !channel.company.id) {
        channel.company = await CompanyFactory.transient({ manager }).create(
          channel.company,
        );
      }
      if (channel.company?.id) channel.companyId = channel.company.id;

      return manager.getRepository(Channel).save(channel);
    });

    const channel = new Channel();
    channel.type = params.type ?? 'whatsapp';
    channel.name = `Channel ${sequence}`;
    channel.externalAccountId = `wa-account-${sequence}`;
    channel.displayAddress = `+519${String(sequence).padStart(8, '0')}`;
    channel.credentials = 'test-credentials';
    channel.settings = { apiVersion: 'v22.0' };
    channel.webhookVerifyToken = `verify-token-${sequence}`;
    channel.status = 'active';

    const company =
      associations.company ??
      (params.companyId
        ? ({ id: params.companyId } as Channel['company'])
        : CompanyFactory.build());
    channel.company = company;
    channel.companyId = company.id;

    return channel;
  },
);
