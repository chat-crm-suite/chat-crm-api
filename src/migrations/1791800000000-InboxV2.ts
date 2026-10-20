// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Inbox v2:
 * - `tasks`: manual work items per member (soft delete), indexed for the
 *   "my tasks" and "team tasks" queries.
 * - `conversation_assignments.note`: internal note of a transfer/release.
 * - `conversations.priority` becomes nullable (`PATCH .../priority` with
 *   `null` clears it); the default stays `low`.
 * - `message_templates`: provider status reason, the placeholders found at
 *   sync, CRM-side settings (variable labels, visibility for agents) and the
 *   last sync time.
 * Additive and nullable (or defaulted): existing rows stay valid.
 */
export class InboxV21791800000000 implements MigrationInterface {
    name = 'InboxV21791800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`tasks\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`title\` varchar(160) NOT NULL, \`description\` text NULL, \`status\` varchar(50) NOT NULL DEFAULT 'open', \`priority\` varchar(50) NOT NULL DEFAULT 'medium', \`due_at\` datetime NULL, \`assignee_member_id\` varchar(36) NOT NULL, \`created_by_member_id\` varchar(36) NULL, \`conversation_id\` varchar(36) NULL, \`customer_id\` varchar(36) NULL, \`completed_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, INDEX \`IDX_tasks_company_assignee_status\` (\`company_id\`, \`assignee_member_id\`, \`status\`), INDEX \`IDX_tasks_company_status_due\` (\`company_id\`, \`status\`, \`due_at\`), INDEX \`IDX_tasks_conversation\` (\`conversation_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_tasks_company\` FOREIGN KEY (\`company_id\`) REFERENCES \`companies\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_tasks_assignee\` FOREIGN KEY (\`assignee_member_id\`) REFERENCES \`company_members\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_tasks_created_by\` FOREIGN KEY (\`created_by_member_id\`) REFERENCES \`company_members\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_tasks_conversation\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`tasks\` ADD CONSTRAINT \`FK_tasks_customer\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);

        await queryRunner.query(`ALTER TABLE \`conversation_assignments\` ADD \`note\` varchar(500) NULL`);
        await queryRunner.query(`ALTER TABLE \`conversations\` MODIFY \`priority\` varchar(50) NULL DEFAULT 'low'`);

        await queryRunner.query(`ALTER TABLE \`message_templates\` ADD \`status_reason\` varchar(500) NULL`);
        await queryRunner.query(`ALTER TABLE \`message_templates\` ADD \`variables\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`message_templates\` ADD \`variable_labels\` json NULL`);
        await queryRunner.query(`ALTER TABLE \`message_templates\` ADD \`visible_to_agents\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`message_templates\` ADD \`synced_at\` datetime NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`message_templates\` DROP COLUMN \`synced_at\``);
        await queryRunner.query(`ALTER TABLE \`message_templates\` DROP COLUMN \`visible_to_agents\``);
        await queryRunner.query(`ALTER TABLE \`message_templates\` DROP COLUMN \`variable_labels\``);
        await queryRunner.query(`ALTER TABLE \`message_templates\` DROP COLUMN \`variables\``);
        await queryRunner.query(`ALTER TABLE \`message_templates\` DROP COLUMN \`status_reason\``);

        await queryRunner.query(`UPDATE \`conversations\` SET \`priority\` = 'low' WHERE \`priority\` IS NULL`);
        await queryRunner.query(`ALTER TABLE \`conversations\` MODIFY \`priority\` varchar(50) NOT NULL DEFAULT 'low'`);
        await queryRunner.query(`ALTER TABLE \`conversation_assignments\` DROP COLUMN \`note\``);

        await queryRunner.query(`ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_tasks_customer\``);
        await queryRunner.query(`ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_tasks_conversation\``);
        await queryRunner.query(`ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_tasks_created_by\``);
        await queryRunner.query(`ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_tasks_assignee\``);
        await queryRunner.query(`ALTER TABLE \`tasks\` DROP FOREIGN KEY \`FK_tasks_company\``);
        await queryRunner.query(`DROP TABLE \`tasks\``);
    }

}
