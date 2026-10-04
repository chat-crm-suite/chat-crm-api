import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards';
import { CompanyGuard } from '../company/company.guard';
import { CompanyMemberService } from './company-member.service';

@Controller('company-members')
@UseGuards(JwtAuthGuard, CompanyGuard)
export class CompanyMemberController {
  constructor(private readonly service: CompanyMemberService) {}

  @Get('current')
  me() {
    return this.service.getMemberActive();
  }

  @Get('companies')
  companies() {
    return this.service.getCompanies();
  }
}
