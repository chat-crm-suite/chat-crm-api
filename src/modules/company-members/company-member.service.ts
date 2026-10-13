// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClsService } from 'nestjs-cls';
import { Repository } from 'typeorm';

import type {
  CompanyMemberListQuery,
  MembershipClaim,
} from '../../contracts/index';
import {
  CLS_COMPANY_ID,
  CLS_MEMBER_ID,
  CLS_USER_ID,
} from '../../config/cls.keys';
import { CompanyMember } from './entities/company-member.entity';

@Injectable()
export class CompanyMemberService {
  constructor(
    @InjectRepository(CompanyMember)
    private readonly repo: Repository<CompanyMember>,
    private readonly cls: ClsService,
  ) {}

  private get userId(): string {
    return this.cls.get(CLS_USER_ID);
  }

  private get companyId() {
    return this.cls.get(CLS_COMPANY_ID);
  }

  /** The verified member of the active company (resolved by the tenant guard). */
  async getMemberActive(): Promise<CompanyMember | null> {
    const memberId = this.cls.get<string>(CLS_MEMBER_ID);
    if (!memberId) return null;

    return this.repo.findOne({ where: { id: memberId } });
  }

  /**
   * Token claims for every active membership of the user in a live company
   * (soft-deleted companies are excluded by the join).
   */
  async findActiveClaims(userId: string): Promise<MembershipClaim[]> {
    const members = await this.repo
      .createQueryBuilder('member')
      .innerJoin('member.company', 'company')
      .where('member.user_id = :userId', { userId })
      .andWhere('member.status = :status', { status: 'active' })
      .orderBy('member.created_at', 'ASC')
      .select(['member.id', 'member.companyId', 'member.role'])
      .getMany();

    return members.map((member) => ({
      cid: member.companyId,
      mid: member.id,
      role: member.role,
    }));
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
