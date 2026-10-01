/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- generated migration uses queryRunner.query(): any */
import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialBaseline1790309234635 implements MigrationInterface {
    name = 'InitialBaseline1790309234635'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Prod arrastra un schema stale (tablas creadas a mano/sync, p.ej.
        // `users` con columna `role` varchar). Si una tabla legacy existe
        // pero esta vacia, se dropea para recrearla desde las entidades.
        // Con datos NO se toca: el CREATE posterior falla y avisa.
        const legacyTables = ['companies', 'contacts', 'chats', 'notifications', 'users', 'transfers', 'whatsapp_configs', 'analysis', 'sentiment_analysis', 'chat_assignments', 'messages', 'members', 'whatsapp_message_details'];
        await queryRunner.query(`SET FOREIGN_KEY_CHECKS = 0`);
        for (const legacyTable of legacyTables) {
            const tableExists = await queryRunner.query(`SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${legacyTable}'`);
            if (Number(tableExists[0]?.cnt) > 0) {
                const rowCount = await queryRunner.query(`SELECT COUNT(*) AS cnt FROM \`${legacyTable}\``);
                if (Number(rowCount[0]?.cnt) === 0) {
                    await queryRunner.query(`DROP TABLE \`${legacyTable}\``);
                }
            }
        }
        await queryRunner.query(`SET FOREIGN_KEY_CHECKS = 1`);
        await queryRunner.query(`CREATE TABLE \`companies\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`email\` varchar(255) NULL, \`phoneNumber\` varchar(50) NULL, \`address\` text NULL, \`status\` varchar(255) NOT NULL DEFAULT 'active', \`deletedAt\` datetime(6) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_d0af6f5866201d5cb424767744\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`contacts\` (\`id\` varchar(36) NOT NULL, \`waId\` varchar(255) NULL, \`firstNames\` varchar(255) NULL, \`lastNames\` varchar(255) NULL, \`username\` varchar(255) NULL, \`profile\` varchar(255) NULL, \`phoneNumber\` varchar(255) NOT NULL, \`email\` varchar(255) NULL, \`status\` varchar(255) NOT NULL DEFAULT 'new', \`source\` varchar(255) NOT NULL DEFAULT 'manual', \`lastInteractionAt\` datetime NULL, \`tags\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`companyId\` varchar(36) NULL, UNIQUE INDEX \`IDX_0886c2d010557204bd4f3dd7bf\` (\`phoneNumber\`, \`companyId\`), UNIQUE INDEX \`IDX_5c2c2331481cf3e7697e9f5e29\` (\`waId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`chats\` (\`id\` varchar(36) NOT NULL, \`status\` enum ('open', 'pending', 'closed', 'archived') NOT NULL DEFAULT 'open', \`lastMessageAt\` datetime NULL, \`priority\` enum ('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'low', \`channel\` enum ('whatsapp', 'telegram', 'messenger', 'sms', 'email') NOT NULL DEFAULT 'whatsapp', \`endedAt\` datetime NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`last_message_id\` varchar(36) NULL, \`clientId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`notifications\` (\`id\` varchar(36) NOT NULL, \`title\` varchar(255) NOT NULL, \`message\` varchar(255) NULL, \`read\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`firstName\` varchar(255) NULL, \`lastName\` varchar(255) NULL, \`phoneNumber\` varchar(255) NULL, \`email\` varchar(255) NULL, \`username\` varchar(255) NOT NULL, \`avatar\` varchar(512) NULL, \`password\` varchar(255) NOT NULL, \`status\` varchar(255) NOT NULL DEFAULT 'offline', \`address\` varchar(512) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, UNIQUE INDEX \`IDX_1e3d0240b49c40521aaeb95329\` (\`phoneNumber\`), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), UNIQUE INDEX \`IDX_fe0bb3f6520ee0469504521e71\` (\`username\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`transfers\` (\`id\` int NOT NULL AUTO_INCREMENT, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`chatId\` varchar(36) NULL, \`fromAgentId\` varchar(36) NULL, \`toAgentId\` varchar(36) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`whatsapp_configs\` (\`id\` varchar(36) NOT NULL, \`apiVersion\` varchar(255) NOT NULL DEFAULT 'v22.0', \`apiBaseUrl\` varchar(255) NOT NULL DEFAULT 'https://graph.facebook.com', \`businessId\` varchar(255) NULL, \`accessToken\` varchar(512) NOT NULL, \`phoneNumberId\` varchar(255) NOT NULL, \`webhookUrl\` varchar(512) NOT NULL, \`webhookVerifyToken\` varchar(256) NOT NULL, \`isActive\` tinyint NOT NULL DEFAULT 1, \`deletedAt\` datetime(6) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`companyId\` varchar(36) NULL, UNIQUE INDEX \`IDX_f573d0683e090a667792f83bf0\` (\`businessId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`analysis\` (\`analysis_id\` varchar(36) NOT NULL, \`type\` enum ('sentiment', 'intent', 'topic') NOT NULL, \`model\` varchar(255) NULL, \`summary\` json NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`messageId\` varchar(36) NULL, PRIMARY KEY (\`analysis_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`sentiment_analysis\` (\`sentiment_analysis_id\` varchar(36) NOT NULL, \`label\` enum ('POS', 'NEU', 'NEG') NOT NULL DEFAULT 'NEU', \`scorePos\` decimal(5,4) NOT NULL DEFAULT '0.0000', \`scoreNeu\` decimal(5,4) NOT NULL DEFAULT '0.0000', \`scoreNeg\` decimal(5,4) NOT NULL DEFAULT '0.0000', \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`analysis_id\` varchar(36) NULL, UNIQUE INDEX \`REL_757cad3bfda9a8c3f8622b5d02\` (\`analysis_id\`), PRIMARY KEY (\`sentiment_analysis_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`chat_assignments\` (\`chat_assignment_id\` varchar(36) NOT NULL, \`assignedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`unassignedAt\` datetime NULL, \`reason\` enum ('transfer', 'escalation', 'manual', 'auto') NOT NULL DEFAULT 'auto', \`chatId\` varchar(36) NULL, \`agentId\` varchar(36) NULL, UNIQUE INDEX \`IDX_cf6aa5dcde4a7505c85956bc9b\` (\`chatId\`, \`agentId\`), PRIMARY KEY (\`chat_assignment_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`messages\` (\`message_id\` varchar(36) NOT NULL, \`senderType\` enum ('agent', 'user', 'client', 'system') NOT NULL DEFAULT 'system', \`senderId\` varchar(255) NULL, \`content\` text NULL, \`type\` enum ('text', 'image', 'document') NOT NULL DEFAULT 'text', \`mediaUrl\` varchar(255) NULL, \`status\` enum ('sent', 'delivered', 'received', 'read', 'failed') NOT NULL DEFAULT 'sent', \`direction\` enum ('in', 'out') NOT NULL DEFAULT 'in', \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, \`chatId\` varchar(36) NULL, PRIMARY KEY (\`message_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`members\` (\`id\` varchar(36) NOT NULL, \`role\` enum ('admin', 'agent', 'manager') NOT NULL DEFAULT 'agent', \`status\` enum ('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active', \`userId\` varchar(36) NULL, \`companyId\` varchar(36) NULL, UNIQUE INDEX \`IDX_19ae8b65015c5afea9c0348ca0\` (\`userId\`, \`companyId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`whatsapp_message_details\` (\`whatsapp_message_detail_id\` varchar(36) NOT NULL, \`waId\` varchar(255) NULL, \`configId\` varchar(36) NULL, \`message_id\` varchar(36) NULL, UNIQUE INDEX \`IDX_65fda6262770c7c6f9e1d14b06\` (\`waId\`), UNIQUE INDEX \`REL_60c63c824451ad1c38811a72d0\` (\`message_id\`), PRIMARY KEY (\`whatsapp_message_detail_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`contacts\` ADD CONSTRAINT \`FK_f4809f4f9ad4a220959788def42\` FOREIGN KEY (\`companyId\`) REFERENCES \`companies\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chats\` ADD CONSTRAINT \`FK_07b7d9dde84f3d2f0403de3bf09\` FOREIGN KEY (\`last_message_id\`) REFERENCES \`messages\`(\`message_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chats\` ADD CONSTRAINT \`FK_59279cb5c542a95d0f22a05d1ab\` FOREIGN KEY (\`clientId\`) REFERENCES \`contacts\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`notifications\` ADD CONSTRAINT \`FK_692a909ee0fa9383e7859f9b406\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfers\` ADD CONSTRAINT \`FK_ca46e351b720421fe72bfe32454\` FOREIGN KEY (\`chatId\`) REFERENCES \`chats\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfers\` ADD CONSTRAINT \`FK_1aa6ccc6c5849166c8b8f8583eb\` FOREIGN KEY (\`fromAgentId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`transfers\` ADD CONSTRAINT \`FK_d9aee364981beff89d2d5097341\` FOREIGN KEY (\`toAgentId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`whatsapp_configs\` ADD CONSTRAINT \`FK_7ddc1c7cdd9da403201cbc74e4c\` FOREIGN KEY (\`companyId\`) REFERENCES \`companies\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`analysis\` ADD CONSTRAINT \`FK_ee32273d2ac88ece93b77592ad2\` FOREIGN KEY (\`messageId\`) REFERENCES \`messages\`(\`message_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`sentiment_analysis\` ADD CONSTRAINT \`FK_757cad3bfda9a8c3f8622b5d02b\` FOREIGN KEY (\`analysis_id\`) REFERENCES \`analysis\`(\`analysis_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chat_assignments\` ADD CONSTRAINT \`FK_4458280c71793a4337a4bc61aea\` FOREIGN KEY (\`chatId\`) REFERENCES \`chats\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chat_assignments\` ADD CONSTRAINT \`FK_18766411cf5f32431854fcdaad4\` FOREIGN KEY (\`agentId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_36bc604c820bb9adc4c75cd4115\` FOREIGN KEY (\`chatId\`) REFERENCES \`chats\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`members\` ADD CONSTRAINT \`FK_839756572a2c38eb5a3b563126e\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`members\` ADD CONSTRAINT \`FK_136a2347b3428cc7b4f1baef918\` FOREIGN KEY (\`companyId\`) REFERENCES \`companies\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`whatsapp_message_details\` ADD CONSTRAINT \`FK_dbd102d2263ac2df6b3accc3dca\` FOREIGN KEY (\`configId\`) REFERENCES \`whatsapp_configs\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`whatsapp_message_details\` ADD CONSTRAINT \`FK_60c63c824451ad1c38811a72d05\` FOREIGN KEY (\`message_id\`) REFERENCES \`messages\`(\`message_id\`) ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`whatsapp_message_details\` DROP FOREIGN KEY \`FK_60c63c824451ad1c38811a72d05\``);
        await queryRunner.query(`ALTER TABLE \`whatsapp_message_details\` DROP FOREIGN KEY \`FK_dbd102d2263ac2df6b3accc3dca\``);
        await queryRunner.query(`ALTER TABLE \`members\` DROP FOREIGN KEY \`FK_136a2347b3428cc7b4f1baef918\``);
        await queryRunner.query(`ALTER TABLE \`members\` DROP FOREIGN KEY \`FK_839756572a2c38eb5a3b563126e\``);
        await queryRunner.query(`ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_36bc604c820bb9adc4c75cd4115\``);
        await queryRunner.query(`ALTER TABLE \`chat_assignments\` DROP FOREIGN KEY \`FK_18766411cf5f32431854fcdaad4\``);
        await queryRunner.query(`ALTER TABLE \`chat_assignments\` DROP FOREIGN KEY \`FK_4458280c71793a4337a4bc61aea\``);
        await queryRunner.query(`ALTER TABLE \`sentiment_analysis\` DROP FOREIGN KEY \`FK_757cad3bfda9a8c3f8622b5d02b\``);
        await queryRunner.query(`ALTER TABLE \`analysis\` DROP FOREIGN KEY \`FK_ee32273d2ac88ece93b77592ad2\``);
        await queryRunner.query(`ALTER TABLE \`whatsapp_configs\` DROP FOREIGN KEY \`FK_7ddc1c7cdd9da403201cbc74e4c\``);
        await queryRunner.query(`ALTER TABLE \`transfers\` DROP FOREIGN KEY \`FK_d9aee364981beff89d2d5097341\``);
        await queryRunner.query(`ALTER TABLE \`transfers\` DROP FOREIGN KEY \`FK_1aa6ccc6c5849166c8b8f8583eb\``);
        await queryRunner.query(`ALTER TABLE \`transfers\` DROP FOREIGN KEY \`FK_ca46e351b720421fe72bfe32454\``);
        await queryRunner.query(`ALTER TABLE \`notifications\` DROP FOREIGN KEY \`FK_692a909ee0fa9383e7859f9b406\``);
        await queryRunner.query(`ALTER TABLE \`chats\` DROP FOREIGN KEY \`FK_59279cb5c542a95d0f22a05d1ab\``);
        await queryRunner.query(`ALTER TABLE \`chats\` DROP FOREIGN KEY \`FK_07b7d9dde84f3d2f0403de3bf09\``);
        await queryRunner.query(`ALTER TABLE \`contacts\` DROP FOREIGN KEY \`FK_f4809f4f9ad4a220959788def42\``);
        await queryRunner.query(`DROP INDEX \`REL_60c63c824451ad1c38811a72d0\` ON \`whatsapp_message_details\``);
        await queryRunner.query(`DROP INDEX \`IDX_65fda6262770c7c6f9e1d14b06\` ON \`whatsapp_message_details\``);
        await queryRunner.query(`DROP TABLE \`whatsapp_message_details\``);
        await queryRunner.query(`DROP INDEX \`IDX_19ae8b65015c5afea9c0348ca0\` ON \`members\``);
        await queryRunner.query(`DROP TABLE \`members\``);
        await queryRunner.query(`DROP TABLE \`messages\``);
        await queryRunner.query(`DROP INDEX \`IDX_cf6aa5dcde4a7505c85956bc9b\` ON \`chat_assignments\``);
        await queryRunner.query(`DROP TABLE \`chat_assignments\``);
        await queryRunner.query(`DROP INDEX \`REL_757cad3bfda9a8c3f8622b5d02\` ON \`sentiment_analysis\``);
        await queryRunner.query(`DROP TABLE \`sentiment_analysis\``);
        await queryRunner.query(`DROP TABLE \`analysis\``);
        await queryRunner.query(`DROP INDEX \`IDX_f573d0683e090a667792f83bf0\` ON \`whatsapp_configs\``);
        await queryRunner.query(`DROP TABLE \`whatsapp_configs\``);
        await queryRunner.query(`DROP TABLE \`transfers\``);
        await queryRunner.query(`DROP INDEX \`IDX_fe0bb3f6520ee0469504521e71\` ON \`users\``);
        await queryRunner.query(`DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``);
        await queryRunner.query(`DROP INDEX \`IDX_1e3d0240b49c40521aaeb95329\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
        await queryRunner.query(`DROP TABLE \`notifications\``);
        await queryRunner.query(`DROP TABLE \`chats\``);
        await queryRunner.query(`DROP INDEX \`IDX_5c2c2331481cf3e7697e9f5e29\` ON \`contacts\``);
        await queryRunner.query(`DROP INDEX \`IDX_0886c2d010557204bd4f3dd7bf\` ON \`contacts\``);
        await queryRunner.query(`DROP TABLE \`contacts\``);
        await queryRunner.query(`DROP INDEX \`IDX_d0af6f5866201d5cb424767744\` ON \`companies\``);
        await queryRunner.query(`DROP TABLE \`companies\``);
    }

}
