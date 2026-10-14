// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Not, Repository } from 'typeorm';

import type { UpdateCompanyProfileInput } from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { UpdateAssignmentSettingsDto } from './dto/assignment-settings.dto';
import { Company } from './entities/company.entity';
import { CompanySettings } from './entities/company-settings.entity';
import { CompanyUpdatedEvent } from './events/company-updated.event';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly repo: Repository<Company>,
    @InjectRepository(CompanySettings)
    private readonly settings: Repository<CompanySettings>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
    private readonly cls: ClsService,
    private readonly eventBus: EventBus,
  ) {}

  get id() {
    const companyId = this.cls.get('company.id');

    return companyId;
  }

  /** The active company (`GET /company/me`). */
  async profile(): Promise<Company> {
    const company = await this.repo.findOneBy({ id: this.id });
    if (!company) throw new NotFoundException('Company not found');

    return company;
  }

  /** Admin edit of the active company data (`PATCH /company/me`). */
  async updateProfile(dto: UpdateCompanyProfileInput): Promise<Company> {
    const company = await this.profile();

    if (dto.email && dto.email !== company.email) {
      const taken = await this.repo.exists({
        where: { email: dto.email, id: Not(company.id) },
        withDeleted: true,
      });
      if (taken) {
        throw new ConflictException({
          code: 'company_email_taken',
          message: 'That email belongs to another company',
        });
      }
    }

    await this.repo.update(company.id, dto);
    this.eventBus.publish(new CompanyUpdatedEvent(company.id));

    return this.profile();
  }

  /** Config de asignación de la empresa activa. */
  async getAssignmentSettings() {
    const company = await this.repo.findOneBy({ id: this.id });
    if (!company) throw new NotFoundException('Company not found');

    let settings = await this.settings.findOneBy({ companyId: this.id });
    if (!settings) {
      // Self-heal companies created outside the setup flow.
      settings = await this.settings.save(
        this.settings.create({ companyId: this.id }),
      );
    }

    return {
      autoAssignEnabled: settings.autoAssignEnabled,
      autoAssignMaxOpen: settings.autoAssignMaxOpen,
      autoAssignSticky: settings.autoAssignSticky,
      autoAssignNotifySupervisors: settings.autoAssignNotifySupervisors,
    };
  }

  /** Actualiza la config; solo admin/supervisor de la empresa. */
  async updateAssignmentSettings(dto: UpdateAssignmentSettingsDto) {
    await this.assertSupervisor();

    // Creates the settings row of a company that never had one, so the
    // update below always has a row to change.
    await this.getAssignmentSettings();
    await this.settings.update({ companyId: this.id }, dto);
    return this.getAssignmentSettings();
  }

  private async assertSupervisor() {
    const userId = this.cls.get<string>('user.id');
    if (!userId) throw new ForbiddenException('User context required');

    const member = await this.members.findOne({
      where: {
        userId,
        companyId: this.id,
        status: 'active',
      },
    });

    const isSupervisor =
      member?.role === 'admin' || member?.role === 'supervisor';
    if (!isSupervisor) {
      throw new ForbiddenException(
        'Only supervisors can change assignment settings',
      );
    }
  }
}
