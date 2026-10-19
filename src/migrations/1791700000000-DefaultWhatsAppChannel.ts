// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { randomBytes } from "crypto";
import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

import { uuidv7 } from "../lib/helpers/uuid.helper";

/**
 * Every name and value this migration touches, in one place. They are a
 * snapshot of the schema at this migration and deliberately NOT imported from
 * the entities or the contracts: if a table, column or value is renamed later,
 * that is a new migration, and this one must keep producing what it produced
 * so a database built from scratch still replays cleanly.
 */
const SCHEMA = {
    companies: { table: 'companies', id: 'id', deletedAt: 'deleted_at' },
    channels: {
        table: 'channels',
        id: 'id',
        companyId: 'company_id',
        type: 'type',
        name: 'name',
        externalAccountId: 'external_account_id',
        credentials: 'credentials',
        settings: 'settings',
        webhookVerifyToken: 'webhook_verify_token',
        status: 'status',
    },
} as const;
const PENDING_WHATSAPP_CHANNEL = {
    type: 'whatsapp',
    name: 'WhatsApp',
    status: 'pending',
    settings: { apiVersion: 'v22.0', apiBaseUrl: 'https://graph.facebook.com' },
} as const;

const { companies, channels } = SCHEMA;

const externalAccountIdColumn = (isNullable: boolean) =>
    new TableColumn({ name: channels.externalAccountId, type: 'varchar', length: '100', isNullable });
const credentialsColumn = (isNullable: boolean) =>
    new TableColumn({ name: channels.credentials, type: 'text', isNullable });

/**
 * Every company owns a WhatsApp channel from birth: a `pending` row holding
 * only the webhook verify token, so the settings screen always has something
 * to copy into Meta. `external_account_id` and `credentials` become nullable
 * (NULL keeps the unique `(type, external_account_id)` index valid for many
 * pending rows). Backfills the companies created before this change.
 *
 * Tables are addressed by name, not through the entity classes (see SCHEMA),
 * which is also why the soft-delete filter on `companies` is spelled out.
 */
export class DefaultWhatsAppChannel1791700000000 implements MigrationInterface {
    name = 'DefaultWhatsAppChannel1791700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.changeColumn(channels.table, channels.externalAccountId, externalAccountIdColumn(true));
        await queryRunner.changeColumn(channels.table, channels.credentials, credentialsColumn(true));

        const missing = await queryRunner.manager
            .createQueryBuilder()
            .select(`c.${companies.id}`, 'id')
            .from(companies.table, 'c')
            .where(`c.${companies.deletedAt} IS NULL`)
            .andWhere((qb) => {
                const whatsapp = qb
                    .subQuery()
                    .select('1')
                    .from(channels.table, 'ch')
                    .where(`ch.${channels.companyId} = c.${companies.id}`)
                    .andWhere(`ch.${channels.type} = :type`)
                    .getQuery();
                return `NOT EXISTS ${whatsapp}`;
            })
            .setParameter('type', PENDING_WHATSAPP_CHANNEL.type)
            .getRawMany<{ id: string }>();

        if (!missing.length) return;

        await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(channels.table, [
                channels.id,
                channels.companyId,
                channels.type,
                channels.name,
                channels.settings,
                channels.webhookVerifyToken,
                channels.status,
            ])
            .values(
                missing.map(({ id }) => ({
                    [channels.id]: uuidv7(),
                    [channels.companyId]: id,
                    [channels.type]: PENDING_WHATSAPP_CHANNEL.type,
                    [channels.name]: PENDING_WHATSAPP_CHANNEL.name,
                    [channels.settings]: JSON.stringify(PENDING_WHATSAPP_CHANNEL.settings),
                    [channels.webhookVerifyToken]: randomBytes(32).toString('hex'),
                    [channels.status]: PENDING_WHATSAPP_CHANNEL.status,
                })),
            )
            .execute();
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(channels.table)
            .where(`${channels.externalAccountId} IS NULL`)
            .orWhere(`${channels.credentials} IS NULL`)
            .execute();
        await queryRunner.changeColumn(channels.table, channels.credentials, credentialsColumn(false));
        await queryRunner.changeColumn(channels.table, channels.externalAccountId, externalAccountIdColumn(false));
    }

}
