// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import type { CompanyMemberListQuery } from '../../contracts/index';
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

  /** Staff of the active company (assignment pickers). */
  async list(query: CompanyMemberListQuery) {
    const qb = this.repo
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.user', 'user')
      .where('member.company_id = :companyId', { companyId: this.companyId })
      .andWhere('member.status = :status', { status: 'active' })
      .andWhere('user.deleted_at IS NULL')
      .orderBy('user.username', 'ASC')
      .take(query.limit);

    if (query.q) {
      qb.andWhere(
        '(user.username LIKE :q OR user.first_name LIKE :q OR user.last_name LIKE :q)',
        { q: `%${query.q}%` },
      );
    }

    const members = await qb.getMany();

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      firstName: member.user.firstName ?? null,
      lastName: member.user.lastName ?? null,
      email: member.user.email ?? null,
      role: member.role,
      status: member.status,
      acceptsAutoAssign: member.acceptsAutoAssign,
      maxOpenConversations: member.maxOpenConversations ?? null,
      joinedAt: member.joinedAt,
    }));
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
