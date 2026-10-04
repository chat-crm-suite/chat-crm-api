import * as bcrypt from 'bcrypt';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
 * - `run()` crea lo que falte en una transacción: usuario admin, empresa,
 *   membresía admin y, opcionalmente, la config de WhatsApp. Si ya está
 *   inicializada responde 409 y no toca nada (idempotente).
 *
 * Usa el esquema existente (users/companies/members/whatsapp_configs): no
 * requiere migraciones.
 */
@Injectable()
export class SetupService {
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
  ) {}

  async status(): Promise<SetupStatus> {
    const [companies, admins, whatsapp] = await Promise.all([
      this.companies.count(),
      this.members.count({
        where: { role: MemberRole.ADMIN, status: MemberStatus.ACTIVE },
      }),
      this.whatsapp.count({ where: { isActive: true } }),
    ]);

    const hasCompany = companies > 0;
    const hasAdmin = admins > 0;

    return {
      initialized: hasCompany && hasAdmin,
      hasAdmin,
      hasCompany,
      hasWhatsapp: whatsapp > 0,
    };
  }

  async run(dto: CreateSetupDto): Promise<SetupResult> {
    const { initialized } = await this.status();

    if (initialized) {
      throw new ConflictException('Application is already initialized');
    }

    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const companies = manager.getRepository(Company);
      const members = manager.getRepository(Member);
      const whatsapp = manager.getRepository(WhatsAppConfig);

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
          throw new UnauthorizedException(
            'The provided credentials do not match the existing admin user',
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
}
