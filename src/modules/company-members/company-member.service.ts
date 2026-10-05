import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import { CompanyMember } from './entities/company-member.entity';

@Injectable()
export class CompanyMemberService {
  constructor(
    @InjectRepository(CompanyMember)
    private readonly repo: Repository<CompanyMember>,
    private readonly cls: ClsService,
  ) {}

  private get userId(): string {
    return this.cls.get('user.id');
  }

  private get companyId() {
    return this.cls.get('company.id');
  }

  async getMemberActive(): Promise<CompanyMember | null> {
    return this.repo.findOne({
      where: { userId: this.userId, companyId: this.companyId },
    });
  }

  /** Company ids the current user belongs to (the front picks the active one). */
  async getCompanies(): Promise<string[]> {
    const members = await this.repo.find({
      where: { userId: this.userId },
      select: { companyId: true },
      order: { createdAt: 'ASC' },
    });

    return [...new Set(members.map((member) => member.companyId))];
  }
}
