import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import { DEFAULT_PIPELINE_STAGES } from '../customers/pipeline-stages.defaults';
import { PipelineStage } from '../customers/entities/pipeline-stage.entity';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateAssignmentSettingsDto } from './dto/assignment-settings.dto';
import { Company } from './entities/company.entity';
import { CompanySettings } from './entities/company-settings.entity';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly repo: Repository<Company>,
    @InjectRepository(CompanySettings)
    private readonly settings: Repository<CompanySettings>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
    @InjectRepository(PipelineStage)
    private readonly stages: Repository<PipelineStage>,
    private readonly cls: ClsService,
  ) {}

  get info() {
    const company = this.repo.findOneBy({ id: this.id });

    return company;
  }

  get id() {
    const companyId = this.cls.get('company.id');

    return companyId;
  }

  async create(dto: CreateCompanyDto) {
    const { phone, ...rest } = dto;
    const company = await this.repo.save(
      this.repo.create({ ...rest, phoneNumber: phone }),
    );

    // 1:1 settings row with engine defaults.
    await this.settings.save(
      this.settings.create({ companyId: company.id }),
    );

    // Default sales pipeline.
    await this.stages.save(
      DEFAULT_PIPELINE_STAGES.map((stage) =>
        this.stages.create({ ...stage, companyId: company.id }),
      ),
    );

    // El creador queda como member admin: evita empresas huérfanas.
    const userId = this.cls.get<string>('user.id');
    if (userId) {
      await this.members.save(
        this.members.create({
          userId,
          companyId: company.id,
          role: 'admin',
          status: 'active',
        }),
      );
    }

    return company;
  }

  findAll() {
    return `This action returns all companies`;
  }

  async findOne(id: string) {
    return await this.repo.findOneBy({ id });
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

  remove(id: number) {
    return `This action removes a #${id} company`;
  }
}
