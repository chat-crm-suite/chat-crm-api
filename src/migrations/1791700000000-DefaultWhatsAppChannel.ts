// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { In, IsNull, MigrationInterface, QueryRunner, TableColumn } from "typeorm";

import { CHANNEL_TYPE } from "../contracts/index";
import { Channel } from "../modules/channels/entities/channel.entity";
import { pendingWhatsAppChannel } from "../modules/company/company-provisioning";
import { Company } from "../modules/company/entities/company.entity";

/** The two columns this migration relaxes (QueryRunner schema API needs names). */
const CHANNELS_TABLE = 'channels';
const externalAccountIdColumn = (isNullable: boolean) =>
    new TableColumn({ name: 'external_account_id', type: 'varchar', length: '100', isNullable });
const credentialsColumn = (isNullable: boolean) =>
    new TableColumn({ name: 'credentials', type: 'text', isNullable });

/**
 * Every company owns a WhatsApp channel from birth: a `pending` row holding
 * only the webhook verify token, so the settings screen always has something
 * to copy into Meta. `external_account_id` and `credentials` become nullable
 * (NULL keeps the unique `(type, external_account_id)` index valid for many
 * pending rows), then live companies without a live WhatsApp channel get one.
 *
 * The backfill goes through the repositories on purpose: a table addressed by
 * name still resolves to its registered entity, which maps values by property
 * name (raw `company_id` keys were silently dropped). The rows come from the
 * same factory as `createCompanyWithDefaults`; TypeORM adds the soft-delete
 * filter, `UuidV7Entity` the id and `ChannelSubscriber` the verify token.
 */
export class DefaultWhatsAppChannel1791700000000 implements MigrationInterface {
    name = 'DefaultWhatsAppChannel1791700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.changeColumn(CHANNELS_TABLE, 'external_account_id', externalAccountIdColumn(true));
        await queryRunner.changeColumn(CHANNELS_TABLE, 'credentials', credentialsColumn(true));

        const companies = await queryRunner.manager
            .getRepository(Company)
            .find({ select: { id: true } });
        if (!companies.length) return;

        const channels = queryRunner.manager.getRepository(Channel);
        const ids = companies.map(({ id }) => id);
        const covered = await channels.find({
            select: { id: true, companyId: true },
            where: { type: CHANNEL_TYPE.whatsapp, companyId: In(ids) },
        });
        const withChannel = new Set(covered.map(({ companyId }) => companyId));
        const missing = ids.filter((id) => !withChannel.has(id));
        if (!missing.length) return;

        await channels.save(missing.map((id) => pendingWhatsAppChannel(channels, id)));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const channels = queryRunner.manager.getRepository(Channel);
        // Rows the NOT NULL columns cannot hold (the pending channels).
        await channels.delete({ externalAccountId: IsNull() });
        await channels.delete({ credentials: IsNull() });
        await queryRunner.changeColumn(CHANNELS_TABLE, 'credentials', credentialsColumn(false));
        await queryRunner.changeColumn(CHANNELS_TABLE, 'external_account_id', externalAccountIdColumn(false));
    }

}
