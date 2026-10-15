// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Team management: `company_members` becomes soft-deletable (re-adding the
 * same account restores the row), records who added each member and stores the
 * member's notification preferences. `customers` gets an index for the
 * "by owner" table filter. Additive and nullable: existing rows stay valid.
 */
export class TeamPlatformSettings1791600000000 implements MigrationInterface {
    name = 'TeamPlatformSettings1791600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`company_members\` ADD \`created_by_member_id\` varchar(36) NULL`);
        await queryRunner.query(`ALTER TABLE \`company_members\` ADD \`notification_prefs\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`company_members\` ADD \`deleted_at\` datetime(6) NULL`);
        await queryRunner.query(`ALTER TABLE \`company_members\` ADD CONSTRAINT \`FK_86c055bd193d8cb98ec3bd739fa\` FOREIGN KEY (\`created_by_member_id\`) REFERENCES \`company_members\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE INDEX \`IDX_8d984b226fb02ef92519246158\` ON \`customers\` (\`company_id\`, \`owner_member_id\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_8d984b226fb02ef92519246158\` ON \`customers\``);
        await queryRunner.query(`ALTER TABLE \`company_members\` DROP FOREIGN KEY \`FK_86c055bd193d8cb98ec3bd739fa\``);
        await queryRunner.query(`ALTER TABLE \`company_members\` DROP COLUMN \`deleted_at\``);
        await queryRunner.query(`ALTER TABLE \`company_members\` DROP COLUMN \`notification_prefs\``);
        await queryRunner.query(`ALTER TABLE \`company_members\` DROP COLUMN \`created_by_member_id\``);
    }

}
