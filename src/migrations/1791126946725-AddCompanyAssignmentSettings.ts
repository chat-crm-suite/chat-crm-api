import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Configuración de asignación automática por empresa (Q18/Q19/Q20).
 * Defaults de producto: activada, sticky on, tope 10, aviso a supervisores on.
 */
export class AddCompanyAssignmentSettings1791126946725 implements MigrationInterface {
    name = 'AddCompanyAssignmentSettings1791126946725'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`companies\` ADD \`auto_assign_enabled\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`companies\` ADD \`auto_assign_max_chats\` int NOT NULL DEFAULT 10`);
        await queryRunner.query(`ALTER TABLE \`companies\` ADD \`auto_assign_sticky\` tinyint NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE \`companies\` ADD \`auto_assign_notify_supervisors\` tinyint NOT NULL DEFAULT 1`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`companies\` DROP COLUMN \`auto_assign_notify_supervisors\``);
        await queryRunner.query(`ALTER TABLE \`companies\` DROP COLUMN \`auto_assign_sticky\``);
        await queryRunner.query(`ALTER TABLE \`companies\` DROP COLUMN \`auto_assign_max_chats\``);
        await queryRunner.query(`ALTER TABLE \`companies\` DROP COLUMN \`auto_assign_enabled\``);
    }

}
