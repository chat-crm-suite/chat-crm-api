import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthUser } from '../../contracts/index';
import { CompanyMember } from '../company-members/entities/company-member.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    @InjectRepository(CompanyMember)
    private readonly members: Repository<CompanyMember>,
  ) {}

  /**
   * `GET /users/me` shape: identity fields plus the company memberships
   * (role per company now lives in company_members).
   */
  async findUserById(id: string): Promise<AuthUser | null> {
    const user = await this.repo.findOne({
      where: { id },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        address: true,
        avatarUrl: true,
        email: true,
        phoneNumber: true,
        isPlatformAdmin: true,
      },
    });

    if (!user) return null;

    const memberships = await this.members.find({
      where: { userId: id },
      relations: { company: true },
      order: { createdAt: 'ASC' },
    });

    return {
      ...user,
      memberships: memberships.map((member) => ({
        companyId: member.companyId,
        companyName: member.company.name,
        role: member.role,
        status: member.status,
      })),
    };
  }
}
