// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

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
import { createCompanyWithDefaults } from '../company/company-provisioning';
import { Company } from '../company/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { encryptCredentials } from '../../lib/helpers/credentials.helper';
import {
  DEFAULT_WHATSAPP_API_VERSION,
  type SetupStepResult,
  type ValidateSetupStepInput,
} from '@contracts';
import { CreateSetupDto } from './dto/create-setup.dto';
import { MetaCredentialsProbe } from './meta-credentials.probe';
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
    private readonly metaProbe: MetaCredentialsProbe,
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
      // Soft-deleted companies still mean the install was set up: deleting the
      // only company from the platform console must not reopen POST /setup.
      this.companies.count({ withDeleted: true }),
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

  /**
   * `POST /setup/validate`: server-side check of ONE wizard step, so errors
   * show on the step that caused them. Shape rules already ran in the DTO;
   * this covers what only the server knows (token, existing user, Meta).
   */
  async validateStep(dto: ValidateSetupStepInput): Promise<SetupStepResult> {
    if ((await this.status()).initialized) {
      throw new ConflictException('Application is already initialized');
    }

    const result: SetupStepResult = {
      ok: true,
      errors: [],
      warnings: [],
      whatsapp: null,
    };

    if (dto.step === 'token') {
      if (!this.tokenMatches(dto.setupToken)) {
        result.errors.push({
          path: 'setupToken',
          message: 'El token de configuración es incorrecto.',
        });
      }
      return { ...result, ok: result.errors.length === 0 };
    }

    // Every later step needs the token: the endpoint is public and the
    // WhatsApp step calls Meta on the caller's behalf.
    this.assertSetupToken(dto.setupToken);

    if (dto.step === 'admin') {
      const existing = await this.users.findOne({
        where: { username: dto.admin.username },
      });
      if (
        existing &&
        !(await bcrypt.compare(dto.admin.password, existing.passwordHash))
      ) {
        result.errors.push({
          path: 'admin.username',
          message:
            'Ya existe un usuario con ese nombre. Usa su contraseña o elige otro nombre.',
        });
      }
    }

    if (dto.step === 'whatsapp') {
      const { whatsapp } = dto;
      if (!/^\d+$/.test(whatsapp.externalAccountId)) {
        result.errors.push({
          path: 'whatsapp.externalAccountId',
          message: 'El Phone Number ID solo tiene dígitos.',
        });
      } else {
        const probe = await this.metaProbe.probe({
          phoneNumberId: whatsapp.externalAccountId,
          accessToken: whatsapp.accessToken,
          appSecret: whatsapp.appSecret,
          apiVersion: whatsapp.apiVersion ?? DEFAULT_WHATSAPP_API_VERSION,
        });
        if (probe.kind === 'ok') {
          result.whatsapp = {
            displayPhoneNumber: probe.displayPhoneNumber,
            verifiedName: probe.verifiedName,
          };
        } else if (probe.kind === 'invalid') {
          result.errors.push(...probe.errors);
        } else {
          this.logger.warn({ reason: probe.reason }, 'setup: Meta unreachable');
          result.warnings.push(
            'No se pudo verificar con Meta ahora mismo; se guardará sin verificar.',
          );
        }
      }
    }

    return { ...result, ok: result.errors.length === 0 };
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

      // Re-comprobación DENTRO de la transacción: evita que dos peticiones
      // simultáneas inicialicen la app dos veces.
      const [companyCount, adminCount] = await Promise.all([
        companies.count({ withDeleted: true }),
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
        company = await createCompanyWithDefaults(manager, {
          name: dto.company.name,
          email: dto.company.email,
          phoneNumber: dto.company.phoneNumber,
          address: dto.company.address,
        });
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
            // The person who sets the install up owns it: they can open the
            // platform console (still gated by PLATFORM_CONSOLE_PASSWORD).
            isPlatformAdmin: true,
          }),
        );
      }

      if (!user.isPlatformAdmin) {
        await users.update(user.id, { isPlatformAdmin: true });
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
              appSecret: dto.whatsapp.appSecret,
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

  private tokenMatches(token?: string): boolean {
    if (!this.setupToken) return true;

    const provided = Buffer.from(token ?? '');
    const expected = Buffer.from(this.setupToken);
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    );
  }

  private assertSetupToken(token?: string): void {
    if (!this.tokenMatches(token)) {
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
