// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * T1 durable intake: one row per inbound WhatsApp `wamid`, written before
 * the webhook answers 200. The unique `wamid` key makes Meta retries a 200
 * noop, and `pending` rows are the replay input for row-first persist (T2).
 */
export class WhatsappInboundEvents1791243728623 implements MigrationInterface {
    name = 'WhatsappInboundEvents1791243728623'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`whatsapp_inbound_events\` (\`id\` varchar(36) NOT NULL, \`wamid\` varchar(255) NOT NULL, \`phone_number_id\` varchar(64) NULL, \`message_type\` varchar(32) NULL, \`payload\` json NOT NULL, \`status\` varchar(32) NOT NULL DEFAULT 'pending', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_inbound_events_wamid\` (\`wamid\`), INDEX \`IDX_inbound_events_status_created\` (\`status\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_inbound_events_status_created\` ON \`whatsapp_inbound_events\``);
        await queryRunner.query(`DROP INDEX \`IDX_inbound_events_wamid\` ON \`whatsapp_inbound_events\``);
        await queryRunner.query(`DROP TABLE \`whatsapp_inbound_events\``);
    }

}
