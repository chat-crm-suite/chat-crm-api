// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * T1 graceful skip: availability skips mean the IA was never reached, so the
 * analysis is terminal as `skipped` and carries why (`kill_switch`,
 * `circuit_breaker`, `ia_unavailable`). `analyses.status` is varchar with no
 * constraint, so the only DDL is the new nullable reason. The down folds
 * skipped rows into `failed` (the closest terminal status the previous
 * contract knows) before dropping the column.
 */
export class AddAnalysisSkipReason1791391130294 implements MigrationInterface {
    name = 'AddAnalysisSkipReason1791391130294'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`analyses\` ADD \`skip_reason\` varchar(50) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE \`analyses\` SET \`status\` = 'failed' WHERE \`status\` = 'skipped'`);
        await queryRunner.query(`ALTER TABLE \`analyses\` DROP COLUMN \`skip_reason\``);
    }

}
