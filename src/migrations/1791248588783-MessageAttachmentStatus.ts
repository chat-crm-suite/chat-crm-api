import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * T3 async media enrichment: inbound attachments are born `pending` with the
 * provider media reference and become `ready` (file stored) or `failed` (the
 * row survives with its caption). Existing rows were already stored, so the
 * default is `ready`.
 */
export class MessageAttachmentStatus1791248588783 implements MigrationInterface {
    name = 'MessageAttachmentStatus1791248588783'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`message_attachments\` ADD \`status\` varchar(32) NOT NULL DEFAULT 'ready'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`message_attachments\` DROP COLUMN \`status\``);
    }

}
