// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Ticket #22 live/replay parity: the durable intake row gains the sender
 * profile-name snapshot (`contacts[].profile.name`) captured at intake. The
 * stored raw payload carries no contacts, so without this column a
 * crash-replayed first contact would resolve the customer as a bare number.
 * Nullable, so rows persisted before the snapshot stay valid and self-heal on
 * the next live message.
 */
export class AddInboundSenderName1791410000000 implements MigrationInterface {
    name = 'AddInboundSenderName1791410000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`whatsapp_inbound_events\` ADD \`sender_name\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`whatsapp_inbound_events\` DROP COLUMN \`sender_name\``);
    }

}
