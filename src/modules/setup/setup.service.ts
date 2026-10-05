import * as bcrypt from 'bcrypt';
import { randomBytes, timingSafeEqual } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';

import { Channel } from '../channels/entities/channel.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CompanySettings } from '../company/entities/company-settings.entity';
import { Company } from '../company/entities/company.entity';
import { DEFAULT_PIPELINE_STAGES } from '../customers/pipeline-stages.defaults';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { User } from '../users/entities/user.entity';
import { encryptCredentials } from '../../lib/helpers/credentials.helper';
import { CreateSetupDto } from './dto/create-setup.dto';
import { SetupResult, SetupStatus } from './setup.types';

/**
 * Primer arranque de la aplicación.
 *
 * - `status()` es la única fuente de verdad para decidir si la app está
 *   inicializada (empresa + member admin activo).
 * - `provision()` crea lo que falte en una transacción: usuario admin, empresa
 *   (+ settings y pipeline por defecto), membresía admin y, opcionalmente, el
 *   canal de WhatsApp con credenciales cifradas. Es la vía interna (bootstrap
 *   headless), sin token.
 * - `run()` es la vía HTTP pública: exige el token de setup y delega en
 *   `provision()`. Si la app ya está inicializada responde 409.
 */
@Injectable()
export class SetupService {
  /** Serializa los provisionamientos dentro del proceso (anti doble arranque). */
  private static chain: Promise<unknown> = Promise.resolve();

  /** Token exigido por `run()`; `null` = no se exige (solo fuera de prod). */
  private readonly setupToken: string | null;

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
    @InjectRepository(Channel)
    private readonly channels: Repository<Channel>,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SetupService.name);
    this.setupToken = this.resolveSetupToken();
  }

  private resolveSetupToken(): string | null {
    const configured = process.env.SETUP_TOKEN?.trim();
    if (configured) return configured;

    if (process.env.NODE_ENV === 'production') {
      const generated = randomBytes(32).toString('hex');
      this.logger.info(
        { setupToken: generated },
        'setup: no SETUP_TOKEN configured, generated a one-time setup token',
      );
      return generated;
    }

    return null;
  }

  get requiresSetupToken(): boolean {
    return this.setupToken !== null;
  }

  async status(): Promise<SetupStatus> {
    const [companies, admins, channels, users] = await Promise.all([
      this.companies.count(),
      this.members.count({ where: { role: 'admin', status: 'active' } }),
      this.channels.count({ where: { type: 'whatsapp', status: 'active' } }),
      this.users.count(),
    ]);

    const hasCompany = companies > 0;
    const hasAdmin = admins > 0;

    return {
      initialized: hasCompany && hasAdmin,
      hasAdmin,
      hasCompany,
      hasWhatsapp: channels > 0,
      hasUsers: users > 0,
      requiresSetupToken: this.requiresSetupToken,
    };
  }

  /** Vía HTTP pública: valida el token y provisiona. */
  async run(dto: CreateSetupDto): Promise<SetupResult> {
    this.assertSetupToken(dto.setupToken);
    return this.provision(dto);
  }

  /** Vía interna confiable (bootstrap headless): sin token. */
  async provision(dto: CreateSetupDto): Promise<SetupResult> {
    return this.serialize(() => this.executeProvision(dto));
  }

  private async executeProvision(dto: CreateSetupDto): Promise<SetupResult> {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const companies = manager.getRepository(Company);
      const members = manager.getRepository(CompanyMember);
      const channels = manager.getRepository(Channel);
      const settings = manager.getRepository(CompanySettings);
      const stages = manager.getRepository(PipelineStage);

      // Re-comprobación DENTRO de la transacción: evita que dos peticiones
      // simultáneas inicialicen la app dos veces.
      const [companyCount, adminCount] = await Promise.all([
        companies.count(),
        members.count({ where: { role: 'admin', status: 'active' } }),
      ]);
      if (companyCount > 0 && adminCount > 0) {
        throw new ConflictException('Application is already initialized');
      }

      // Reutiliza la primera empresa si ya existe (estado parcial).
      const existingCompany = await companies.findOne({
        where: {},
        order: { createdAt: 'ASC' },
      });

      let company: Company;
      if (existingCompany) {
        company = existingCompany;
      } else {
        company = await companies.save(
          companies.create({
            name: dto.company.name,
            email: dto.company.email,
            phoneNumber: dto.company.phoneNumber,
            address: dto.company.address,
          }),
        );

        await settings.save(settings.create({ companyId: company.id }));
        await stages.save(
          DEFAULT_PIPELINE_STAGES.map((stage) =>
            stages.create({ ...stage, companyId: company.id }),
          ),
        );
      }

      // Reutiliza el admin si ya existe (bootstrap previo), verificando la
      // contraseña para no crear credenciales divergentes.
      let user = await users.findOne({
        where: { username: dto.admin.username },
      });
      if (user) {
        const valid = await bcrypt.compare(dto.admin.password, user.passwordHash);
        if (!valid) {
          throw new ConflictException(
            'Ya existe un usuario con ese nombre. Usa la contraseña de ese usuario o elige otro nombre de usuario.',
          );
        }
      } else {
        user = await users.save(
          users.create({
            username: dto.admin.username,
            passwordHash: await bcrypt.hash(dto.admin.password, 10),
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
            email: dto.admin.email,
            phoneNumber: dto.admin.phoneNumber,
          }),
        );
      }

      const existingMember = await members.findOne({
        where: { userId: user.id, companyId: company.id },
      });
      if (!existingMember) {
        await members.save(
          members.create({
            userId: user.id,
            companyId: company.id,
            role: 'admin',
            status: 'active',
          }),
        );
      }

      let channel: Channel | null = null;
      if (dto.whatsapp) {
        channel = await channels.save(
          channels.create({
            companyId: company.id,
            type: 'whatsapp',
            name:
              dto.whatsapp.name ?? dto.whatsapp.displayAddress ?? 'WhatsApp',
            externalAccountId: dto.whatsapp.externalAccountId,
            displayAddress: dto.whatsapp.displayAddress,
            credentials: encryptCredentials({
              accessToken: dto.whatsapp.accessToken,
              businessId: dto.whatsapp.businessId,
            }),
            settings: {
              apiVersion: dto.whatsapp.apiVersion ?? 'v22.0',
              apiBaseUrl:
                dto.whatsapp.apiBaseUrl ?? 'https://graph.facebook.com',
              webhookUrl: dto.whatsapp.webhookUrl,
            },
            webhookVerifyToken:
              dto.whatsapp.webhookVerifyToken ??
              randomBytes(32).toString('hex'),
            status: 'active',
          }),
        );
      }

      return {
        user: { id: user.id, username: user.username },
        company: { id: company.id, name: company.name },
        channel: channel
          ? {
              id: channel.id,
              webhookVerifyToken: channel.webhookVerifyToken ?? null,
            }
          : null,
      };
    });
  }

  private assertSetupToken(token?: string): void {
    if (!this.setupToken) return;

    const provided = Buffer.from(token ?? '');
    const expected = Buffer.from(this.setupToken);
    const matches =
      provided.length === expected.length && timingSafeEqual(provided, expected);

    if (!matches) {
      throw new ForbiddenException(
        'Falta o es incorrecto el token de configuración',
      );
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = SetupService.chain.then(task, task);
    SetupService.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
