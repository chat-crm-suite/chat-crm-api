// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Template messages render natively in the thread: each one keeps the
 * template as sent (header, body, footer, buttons with values filled).
 */
export class TemplateSnapshot1792000000000 implements MigrationInterface {
    name = 'TemplateSnapshot1792000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`messages\` ADD \`template_snapshot\` json NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`messages\` DROP COLUMN \`template_snapshot\``);
    }

}
