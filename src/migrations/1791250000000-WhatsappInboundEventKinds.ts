// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Durable status ticks (T4 replay): the intake row gains a `kind`
 * (`message` | `status:<state>`), and the exactly-once key becomes
 * `(wamid, kind)` so a status tick never collides with the message event of
 * the same wamid. Existing rows were all messages.
 */
export class WhatsappInboundEventKinds1791250000000 implements MigrationInterface {
    name = 'WhatsappInboundEventKinds1791250000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`whatsapp_inbound_events\` ADD \`kind\` varchar(32) NOT NULL DEFAULT 'message'`);
        await queryRunner.query(`DROP INDEX \`IDX_inbound_events_wamid\` ON \`whatsapp_inbound_events\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_inbound_events_wamid_kind\` ON \`whatsapp_inbound_events\` (\`wamid\`, \`kind\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_inbound_events_wamid_kind\` ON \`whatsapp_inbound_events\``);
        await queryRunner.query(`CREATE UNIQUE INDEX \`IDX_inbound_events_wamid\` ON \`whatsapp_inbound_events\` (\`wamid\`)`);
        await queryRunner.query(`ALTER TABLE \`whatsapp_inbound_events\` DROP COLUMN \`kind\``);
    }

}
