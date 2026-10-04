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

import { Company, User, WhatsAppConfig } from '../../entities/index';
import { Member } from '../member/member.entity';
import { MemberRole, MemberStatus } from '../member/member.types';
import { CreateSetupDto } from './dto/create-setup.dto';
import { SetupResult, SetupStatus } from './setup.types';

/**
 * Primer arranque de la aplicación.
 *
 * - `status()` es la única fuente de verdad para decidir si la app está
 *   inicializada (empresa + member admin activo).
 * - `provision()` crea lo que falte en una transacción: usuario admin, empresa,
 *   membresía admin y, opcionalmente, la config de WhatsApp. Es la vía interna
 *   (bootstrap headless), sin token.
 * - `run()` es la vía HTTP pública: exige el token de setup y delega en
 *   `provision()`. Si la app ya está inicializada responde 409.
 *
 * Usa el esquema existente (users/companies/members/whatsapp_configs): no
 * requiere migraciones.
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
    @InjectRepository(Member)
    private readonly members: Repository<Member>,
    @InjectRepository(WhatsAppConfig)
    private readonly whatsapp: Repository<WhatsAppConfig>,
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
    const [companies, admins, whatsapp, users] = await Promise.all([
      this.companies.count(),
      this.members.count({
        where: { role: MemberRole.ADMIN, status: MemberStatus.ACTIVE },
      }),
      this.whatsapp.count({ where: { isActive: true } }),
      this.users.count(),
    ]);

    const hasCompany = companies > 0;
    const hasAdmin = admins > 0;

    return {
      initialized: hasCompany && hasAdmin,
      hasAdmin,
      hasCompany,
      hasWhatsapp: whatsapp > 0,
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
      const members = manager.getRepository(Member);
      const whatsapp = manager.getRepository(WhatsAppConfig);

      // Re-comprobación DENTRO de la transacción: evita que dos peticiones
      // simultáneas inicialicen la app dos veces.
      const [companyCount, adminCount] = await Promise.all([
        companies.count(),
        members.count({
          where: { role: MemberRole.ADMIN, status: MemberStatus.ACTIVE },
        }),
      ]);
      if (companyCount > 0 && adminCount > 0) {
        throw new ConflictException('Application is already initialized');
      }

      // Reutiliza la primera empresa si ya existe (estado parcial).
      let company = await companies.findOne({
        where: {},
        order: { createdAt: 'ASC' },
      });
      if (!company) {
        company = await companies.save(companies.create({ ...dto.company }));
      }

      // Reutiliza el admin si ya existe (bootstrap previo), verificando la
      // contraseña para no crear credenciales divergentes.
      let user = await users.findOne({
        where: { username: dto.admin.username },
      });
      if (user) {
        const valid = await bcrypt.compare(dto.admin.password, user.password);
        if (!valid) {
          throw new ConflictException(
            'Ya existe un usuario con ese nombre. Usa la contraseña de ese usuario o elige otro nombre de usuario.',
          );
        }
      } else {
        user = await users.save(users.create({ ...dto.admin }));
      }

      const existingMember = await members.findOne({
        where: { user: { id: user.id }, company: { id: company.id } },
      });
      if (!existingMember) {
        await members.save(
          members.create({
            user,
            company,
            role: MemberRole.ADMIN,
            status: MemberStatus.ACTIVE,
          }),
        );
      }

      let config: WhatsAppConfig | null = null;
      if (dto.whatsapp) {
        config = await whatsapp.save(
          whatsapp.create({ ...dto.whatsapp, company }),
        );
      }

      return {
        user: { id: user.id, username: user.username },
        company: { id: company.id, name: company.name },
        whatsapp: config
          ? { id: config.id, webhookVerifyToken: config.webhookVerifyToken }
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
