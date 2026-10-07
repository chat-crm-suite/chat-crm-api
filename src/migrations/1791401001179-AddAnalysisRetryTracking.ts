// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * T4 deferred retry: a skipped analysis keeps its own row and learns when its
 * next retry is due (`next_retry_at`) and how many attempts were already
 * enqueued (`retry_count`). Existing rows default to "never retried"; the down
 * only drops the tracking, the analysis rows themselves are untouched.
 */
export class AddAnalysisRetryTracking1791401001179 implements MigrationInterface {
    name = 'AddAnalysisRetryTracking1791401001179'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`analyses\` ADD \`retry_count\` int NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE \`analyses\` ADD \`next_retry_at\` datetime NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`analyses\` DROP COLUMN \`next_retry_at\``);
        await queryRunner.query(`ALTER TABLE \`analyses\` DROP COLUMN \`retry_count\``);
    }

}
