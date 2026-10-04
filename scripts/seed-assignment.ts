/**
 * Seed de demo para la asignación automática (SOLO DESARROLLO).
 *
 * Crea (idempotente): 1 empresa demo, 3 agentes, 6 chats que se reparten por
 * carga y 1 chat que queda en la cola de sin asignar. Los chats llevan un
 * mensaje entrante simulado para que se vean en el front.
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

import { Chat, Company, Contact, Message, User } from '../src/entities/index';
import { ChatAssignmentService } from '../src/modules/chats/assignment/chat-assignment.service';
import { ChatAssignments } from '../src/modules/chats/entities/index';
import { Member } from '../src/modules/member/member.entity';
import { MemberRole, MemberStatus } from '../src/modules/member/member.types';
import {
  MessageDirection,
  MessageSenderType,
  MessageStatus,
  MessageType,
} from '../src/modules/message/message.enum';

// Carga .env si existe (Node 22). Si no, usa las variables del entorno.
try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {
  // sin .env: DB_* debe venir del entorno
}

const DEMO_COMPANY_NAME = 'Demo Asignación';
const AGENT_PASSWORD = 'demo1234';
const AGENT_USERNAMES = ['seed-agent-1', 'seed-agent-2', 'seed-agent-3'];
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
    const users = dataSource.getRepository(User);
    const members = dataSource.getRepository(Member);
    const contacts = dataSource.getRepository(Contact);
    const chats = dataSource.getRepository(Chat);
    const messages = dataSource.getRepository(Message);
    const assignments = dataSource.getRepository(ChatAssignments);

    const company =
      (await companies.findOne({ where: { name: DEMO_COMPANY_NAME } })) ??
      (await companies.save(companies.create({ name: DEMO_COMPANY_NAME })));

    const password = await bcrypt.hash(AGENT_PASSWORD, 10);
    const agents: User[] = [];
    for (const username of AGENT_USERNAMES) {
      let user = await users.findOne({ where: { username } });
      if (!user) {
        user = await users.save(
          users.create({
            username,
            password,
            email: `${username}@demo.local`,
            role: 'agent',
          }),
        );
      }

      const membership = await members.findOne({
        where: { user: { id: user.id }, company: { id: company.id } },
      });
      if (!membership) {
        await members.save(
          members.create({
            user,
            company,
            role: MemberRole.AGENT,
            status: MemberStatus.ACTIVE,
          }),
        );
      }
      agents.push(user);
    }

    const engine = new ChatAssignmentService(dataSource, logger);

    const ensureChat = async (phoneNumber: string) => {
      let contact = await contacts.findOne({
        where: { phoneNumber, company: { id: company.id } },
      });
      if (!contact) {
        contact = await contacts.save(
          contacts.create({
            phoneNumber,
            username: phoneNumber,
            company,
          }),
        );
      }

      let chat = await chats.findOne({ where: { client: { id: contact.id } } });
      if (!chat) {
        chat = await chats.save(chats.create({ client: contact }));
      }

      const hasMessages = await messages.count({ where: { chat: { id: chat.id } } });
      if (!hasMessages) {
        const message = await messages.save(
          messages.create({
            chat: { id: chat.id },
            senderType: MessageSenderType.CLIENT,
            senderId: contact.id,
            content: `Hola, consulta de prueba ${phoneNumber}`,
            direction: MessageDirection.IN,
            status: MessageStatus.SENT,
            type: MessageType.TEXT,
          }),
        );
        await chats.update(
          { id: chat.id },
          { lastMessage: { id: message.id }, lastMessageAt: new Date() },
        );
      }

      return chat;
    };

    // 6 chats se reparten entre 3 agentes (2 c/u por menor carga).
    for (const phone of ASSIGNED_PHONES) {
      const chat = await ensureChat(phone);
      await engine.ensureAssigned(chat.id, company.id);
    }

    // 1 chat queda sin asignar para demo de la cola + claim.
    await ensureChat(QUEUE_PHONE);

    const distribution = await Promise.all(
      agents.map(async (agent) => ({
        username: agent.username,
        chats: await assignments.count({
          where: { agent: { id: agent.id }, unassignedAt: IsNull() },
        }),
      })),
    );
    const queue = await engine.listUnassigned(company.id);

    console.log('\n=== Seed de asignación (demo) ===');
    console.log(`Empresa: ${company.name} (${company.id})`);
    console.log(`Agentes (password: ${AGENT_PASSWORD}):`);
    for (const agent of distribution) {
      console.log(`  - ${agent.username}: ${agent.chats} chats activos`);
    }
    console.log(`Cola sin asignar: ${queue.length} chat(s) → ${QUEUE_PHONE}`);
    console.log('\nListo: entrá al front con cualquier seed-agent y mirá la lista y la cola.');
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error) => {
  console.error('Seed falló:', error);
  process.exitCode = 1;
});
