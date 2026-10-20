// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Channel health: why a channel is `error` (provider refused its credentials)
 * and when its status last changed, so the inbox can say WhatsApp is down.
 */
export class ChannelStatusReason1791810000000 implements MigrationInterface {
    name = 'ChannelStatusReason1791810000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`channels\` ADD \`status_reason\` varchar(500) NULL`);
        await queryRunner.query(`ALTER TABLE \`channels\` ADD \`status_changed_at\` datetime NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`channels\` DROP COLUMN \`status_changed_at\``);
        await queryRunner.query(`ALTER TABLE \`channels\` DROP COLUMN \`status_reason\``);
    }

}
