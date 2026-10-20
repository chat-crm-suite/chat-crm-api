// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notifications v2: severity, grouping (`group_key` + `count`) and
 * `updated_at`, which orders the bell and drives the reconnect replay.
 */
export class NotificationsV21791900000000 implements MigrationInterface {
    name = 'NotificationsV21791900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD \`severity\` varchar(20) NOT NULL DEFAULT 'info'`);
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD \`group_key\` varchar(120) NULL`);
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD \`count\` int NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)`);
        await queryRunner.query(`UPDATE \`notifications\` SET \`updated_at\` = \`created_at\``);
        await queryRunner.query(`CREATE INDEX \`IDX_8a0f94292eaacab904a87a0084\` ON \`notifications\` (\`recipient_member_id\`, \`group_key\`, \`read_at\`)`);
        await queryRunner.query(`CREATE INDEX \`IDX_5b176218ff17ae4ec12e00684e\` ON \`notifications\` (\`recipient_member_id\`, \`company_id\`, \`updated_at\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_5b176218ff17ae4ec12e00684e\` ON \`notifications\``);
        await queryRunner.query(`DROP INDEX \`IDX_8a0f94292eaacab904a87a0084\` ON \`notifications\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP COLUMN \`updated_at\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP COLUMN \`count\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP COLUMN \`group_key\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP COLUMN \`severity\``);
    }

}
