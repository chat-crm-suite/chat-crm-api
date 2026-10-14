// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Analytics v2: the data the role dashboards measure.
 *
 * - `cases` + `case_replies`: support-case lifecycle (open/close/reopen) and
 *   one row per answered customer burst. `cases.open_key` is unique and only
 *   set while open, so a conversation never holds two open cases.
 * - `presence_intervals`: connected time per member and state.
 * - `channel_charges` + `channel_rates`: what each provider reported as
 *   billable (idempotent per message) and the company's editable prices.
 * - `company_settings`: SLA threshold/target, monthly budget, billable-send
 *   pause and the last budget alert sent.
 *
 * All new tables are additive; existing rows keep working (history before the
 * deploy simply has no cases, so the dashboards start empty).
 */
export class AnalyticsV21791500000000 implements MigrationInterface {
    name = 'AnalyticsV21791500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`cases\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`conversation_id\` varchar(36) NOT NULL, \`channel_type\` varchar(50) NOT NULL, \`customer_id\` varchar(36) NOT NULL, \`status\` varchar(50) NOT NULL DEFAULT 'open', \`open_key\` varchar(36) NULL, \`opened_at\` datetime NOT NULL, \`first_response_at\` datetime NULL, \`first_responder_member_id\` varchar(36) NULL, \`awaiting_reply_since\` datetime NULL, \`inbound_count\` int NOT NULL DEFAULT '0', \`outbound_count\` int NOT NULL DEFAULT '0', \`owner_member_id\` varchar(36) NULL, \`closed_at\` datetime NULL, \`closed_by_member_id\` varchar(36) NULL, \`close_note\` varchar(500) NULL, \`reopen_of_case_id\` varchar(36) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_cases_company_opened\` (\`company_id\`, \`opened_at\`), INDEX \`IDX_cases_company_closed\` (\`company_id\`, \`closed_at\`), INDEX \`IDX_cases_company_status\` (\`company_id\`, \`status\`), INDEX \`IDX_cases_conversation_opened\` (\`conversation_id\`, \`opened_at\`), UNIQUE INDEX \`UQ_cases_open_key\` (\`open_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`case_replies\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`case_id\` varchar(36) NOT NULL, \`member_id\` varchar(36) NULL, \`awaited_from\` datetime NOT NULL, \`replied_at\` datetime NOT NULL, \`is_first\` tinyint NOT NULL DEFAULT 0, INDEX \`IDX_case_replies_company_replied\` (\`company_id\`, \`replied_at\`), INDEX \`IDX_case_replies_case\` (\`case_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`presence_intervals\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`member_id\` varchar(36) NOT NULL, \`state\` varchar(20) NOT NULL, \`started_at\` datetime NOT NULL, \`ended_at\` datetime NULL, INDEX \`IDX_presence_intervals_company_started\` (\`company_id\`, \`started_at\`), INDEX \`IDX_presence_intervals_member_ended\` (\`member_id\`, \`ended_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`channel_charges\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`channel_id\` varchar(36) NULL, \`channel_type\` varchar(50) NOT NULL, \`message_id\` varchar(36) NOT NULL, \`category\` varchar(50) NOT NULL, \`billable\` tinyint NOT NULL DEFAULT 0, \`pricing_model\` varchar(50) NULL, \`occurred_at\` datetime NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_channel_charges_company_occurred\` (\`company_id\`, \`occurred_at\`), UNIQUE INDEX \`UQ_channel_charges_message\` (\`message_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`channel_rates\` (\`id\` varchar(36) NOT NULL, \`company_id\` varchar(36) NOT NULL, \`channel_type\` varchar(50) NOT NULL, \`category\` varchar(50) NOT NULL, \`usd_per_unit\` decimal(10,6) NOT NULL DEFAULT '0.000000', \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`UQ_channel_rates_company_channel_category\` (\`company_id\`, \`channel_type\`, \`category\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`company_settings\` ADD \`sla_first_response_seconds\` int NOT NULL DEFAULT '300'`);
        await queryRunner.query(`ALTER TABLE \`company_settings\` ADD \`sla_target_share\` decimal(4,3) NOT NULL DEFAULT '0.800'`);
        await queryRunner.query(`ALTER TABLE \`company_settings\` ADD \`monthly_budget_usd\` decimal(12,2) NULL`);
        await queryRunner.query(`ALTER TABLE \`company_settings\` ADD \`billable_sends_paused\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`company_settings\` ADD \`budget_alert_key\` varchar(30) NULL`);
        await queryRunner.query(`ALTER TABLE \`cases\` ADD CONSTRAINT \`FK_cases_company\` FOREIGN KEY (\`company_id\`) REFERENCES \`companies\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`cases\` ADD CONSTRAINT \`FK_cases_conversation\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`case_replies\` ADD CONSTRAINT \`FK_case_replies_case\` FOREIGN KEY (\`case_id\`) REFERENCES \`cases\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`case_replies\` DROP FOREIGN KEY \`FK_case_replies_case\``);
        await queryRunner.query(`ALTER TABLE \`cases\` DROP FOREIGN KEY \`FK_cases_conversation\``);
        await queryRunner.query(`ALTER TABLE \`cases\` DROP FOREIGN KEY \`FK_cases_company\``);
        await queryRunner.query(`ALTER TABLE \`company_settings\` DROP COLUMN \`budget_alert_key\``);
        await queryRunner.query(`ALTER TABLE \`company_settings\` DROP COLUMN \`billable_sends_paused\``);
        await queryRunner.query(`ALTER TABLE \`company_settings\` DROP COLUMN \`monthly_budget_usd\``);
        await queryRunner.query(`ALTER TABLE \`company_settings\` DROP COLUMN \`sla_target_share\``);
        await queryRunner.query(`ALTER TABLE \`company_settings\` DROP COLUMN \`sla_first_response_seconds\``);
        await queryRunner.query(`DROP TABLE \`channel_rates\``);
        await queryRunner.query(`DROP TABLE \`channel_charges\``);
        await queryRunner.query(`DROP TABLE \`presence_intervals\``);
        await queryRunner.query(`DROP TABLE \`case_replies\``);
        await queryRunner.query(`DROP TABLE \`cases\``);
    }

}
