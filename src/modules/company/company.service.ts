import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCompanyDto } from './dto/create-company.dto';
import { Company } from './entities/company.entity';
import { ClsService } from 'nestjs-cls';
import { Member } from '../member/member.entity';
import { MemberRole, MemberStatus } from '../member/member.types';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly repo: Repository<Company>,
    @InjectRepository(Member)
    private readonly members: Repository<Member>,
    private readonly cls: ClsService,
  ) { }

  get info() {
    const company = this.repo.findOneBy({ id: this.id });

    return company
  }

  get id() {
    const companyId = this.cls.get('company.id');

    return companyId
  }

  async create(dto: CreateCompanyDto) {
    const company = await this.repo.save(this.repo.create(dto));

    // El creador queda como member admin: evita empresas huérfanas.
    const userId = this.cls.get<string>('user.id');
    if (userId) {
      await this.members.save(
        this.members.create({
          user: { id: userId },
          company,
          role: MemberRole.ADMIN,
          status: MemberStatus.ACTIVE,
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

  // update(id: number, updateCompanyDto: UpdateCompanyDto) {
  //   return `This action updates a #${id} company`;
  // }

  remove(id: number) {
    return `This action removes a #${id} company`;
  }
}
