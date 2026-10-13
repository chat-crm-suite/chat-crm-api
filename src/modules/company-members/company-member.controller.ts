// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Query } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';

import { CompanyMemberResponseSchema } from '../../contracts/index';
import { CompanyMemberService } from './company-member.service';
import { CompanyMemberListQueryDto } from './dto/company-member-list-query.dto';
import { UserScoped } from '@auth';

@Controller('company-members')
export class CompanyMemberController {
  constructor(private readonly service: CompanyMemberService) {}

  @Get()
  @ZodSerializerDto(CompanyMemberResponseSchema.array())
  list(@Query() query: CompanyMemberListQueryDto) {
    return this.service.list(query);
  }

  @Get('current')
  me() {
    return this.service.getMemberActive();
  }

  /** Every company of the session user, regardless of the active one. */
  @UserScoped()
  @Get('companies')
  companies() {
    return this.service.getCompanies();
  }
}
