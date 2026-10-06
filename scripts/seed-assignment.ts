// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Seed de demo para la asignación automática (SOLO DESARROLLO).
 *
 * Crea (idempotente): 1 empresa demo con `company_settings`, 3 agentes, 6
 * conversaciones que se reparten por carga y 1 conversación que queda en la
 * cola de sin asignar. Cada conversación lleva un mensaje entrante simulado
 * para que se vea en el front.
 *
 * Uso (desde chat-crm-api/):
 *   npx ts-node --transpile-only scripts/seed-assignment.ts
 *   (o dentro del contenedor api: docker exec -it <api> npx ts-node --transpile-only scripts/seed-assignment.ts)
 *
 * Requiere DB_* en el entorno o un .env en la raíz del repo (Node 22).
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { DataSource, IsNull } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import type { PinoLogger } from 'nestjs-pino';

import {
  Channel,
  Company,
  CompanyMember,
  CompanySettings,
  Conversation,
  ConversationAssignment,
  Customer,
  Message,
  User,
} from '../src/entities/index';
import { ConversationAssignmentService } from '../src/modules/conversations/assignment/conversation-assignment.service';

// Carga .env si existe (Node 22). Si no, usa las variables del entorno.
try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {
  // sin .env: DB_* debe venir del entorno
}

const DEMO_COMPANY_NAME = 'Demo Asignación';
const AGENT_PASSWORD = 'demo1234';
const AGENT_USERNAMES = ['seed-agent-1', 'seed-agent-2', 'seed-agent-3'];
const CHANNEL_EXTERNAL_ACCOUNT_ID = 'seed-demo-wa-account';
const ASSIGNED_PHONES = [1, 2, 3, 4, 5, 6].map(
  (n) => `+54911000000${n}`,
);
const QUEUE_PHONE = '+5491100000099';

const logger = {
  setContext: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;

async function main() {
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });

  await dataSource.initialize();

  try {
    const companies = dataSource.getRepository(Company);
    const settingsRepo = dataSource.getRepository(CompanySettings);
    const users = dataSource.getRepository(User);
    const members = dataSource.getRepository(CompanyMember);
    const channels = dataSource.getRepository(Channel);
    const customers = dataSource.getRepository(Customer);
    const conversations = dataSource.getRepository(Conversation);
    const messages = dataSource.getRepository(Message);
    const assignments = dataSource.getRepository(ConversationAssignment);

    const company =
      (await companies.findOne({ where: { name: DEMO_COMPANY_NAME } })) ??
      (await companies.save(companies.create({ name: DEMO_COMPANY_NAME })));

    // Settings 1:1: sin fila, el motor no asigna.
    if (!(await settingsRepo.findOne({ where: { companyId: company.id } }))) {
      await settingsRepo.save(settingsRepo.create({ companyId: company.id }));
    }

    const password = await bcrypt.hash(AGENT_PASSWORD, 10);
    const memberRows: CompanyMember[] = [];
    for (const username of AGENT_USERNAMES) {
      let user = await users.findOne({ where: { username } });
      if (!user) {
        user = await users.save(
          users.create({
            username,
            passwordHash: password,
            email: `${username}@demo.local`,
            isPlatformAdmin: false,
          }),
        );
      }

      let membership = await members.findOne({
        where: { userId: user.id, companyId: company.id },
      });
      if (!membership) {
        membership = await members.save(
          members.create({
            userId: user.id,
            companyId: company.id,
            role: 'agent',
            status: 'active',
          }),
        );
      }
      memberRows.push(membership);
    }

    const channel =
      (await channels.findOne({
        where: { companyId: company.id, type: 'whatsapp' },
      })) ??
      (await channels.save(
        channels.create({
          companyId: company.id,
          type: 'whatsapp',
          name: 'WhatsApp Demo',
          externalAccountId: CHANNEL_EXTERNAL_ACCOUNT_ID,
          credentials: 'seed-demo-not-a-real-envelope',
          settings: { apiVersion: 'v22.0' },
          webhookVerifyToken: 'seed-demo-verify-token',
          status: 'active',
        }),
      ));

    const engine = new ConversationAssignmentService(dataSource, logger);

    const ensureConversation = async (phoneNumber: string) => {
      let customer = await customers.findOne({
        where: { companyId: company.id, phoneNumber },
      });
      if (!customer) {
        customer = await customers.save(
          customers.create({
            companyId: company.id,
            phoneNumber,
            displayName: phoneNumber,
            source: 'whatsapp',
          }),
        );
      }

      let conversation = await conversations.findOne({
        where: {
          companyId: company.id,
          customerId: customer.id,
          channelId: channel.id,
        },
      });
      if (!conversation) {
        conversation = await conversations.save(
          conversations.create({
            companyId: company.id,
            customerId: customer.id,
            channelId: channel.id,
            status: 'open',
            priority: 'low',
          }),
        );
      }

      const hasMessages = await messages.count({
        where: { conversationId: conversation.id },
      });
      if (!hasMessages) {
        const now = new Date();
        const message = await messages.save(
          messages.create({
            companyId: company.id,
            conversationId: conversation.id,
            direction: 'inbound',
            senderType: 'customer',
            senderCustomerId: customer.id,
            body: `Hola, consulta de prueba ${phoneNumber}`,
            type: 'text',
            status: 'delivered',
          }),
        );
        await conversations.update(
          { id: conversation.id },
          {
            lastMessageId: message.id,
            lastMessageAt: now,
            lastInboundAt: now,
            status: 'open',
          },
        );
      }

      return conversation;
    };

    // 6 conversaciones se reparten entre 3 agentes (2 c/u por menor carga).
    for (const phone of ASSIGNED_PHONES) {
      const conversation = await ensureConversation(phone);
      await engine.ensureAssigned(conversation.id, company.id);
    }

    // 1 conversación queda sin asignar para demo de la cola + claim.
    await ensureConversation(QUEUE_PHONE);

    const distribution = await Promise.all(
      memberRows.map(async (member) => {
        const user = await users.findOneByOrFail({ id: member.userId });
        return {
          username: user.username,
          conversations: await assignments.count({
            where: { memberId: member.id, unassignedAt: IsNull() },
          }),
        };
      }),
    );
    const queue = await engine.listUnassigned(company.id);

    console.log('\n=== Seed de asignación (demo) ===');
    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(`Agentes (password: ${AGENT_PASSWORD}):`);
    for (const agent of distribution) {
      console.log(`  - ${agent.username}: ${agent.conversations} conversaciones activas`);
    }
    console.log(`Cola sin asignar: ${queue.length} conversación(es) → ${QUEUE_PHONE}`);
    console.log('\nListo: entrá al front con cualquier seed-agent y mirá la lista y la cola.');
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error('Seed falló:', error);
  process.exitCode = 1;
});
