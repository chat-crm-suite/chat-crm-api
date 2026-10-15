// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  CompanyMemberResponseSchema,
  CreateMemberResultSchema,
  RemoveMemberResultSchema,
  ResetMemberPasswordResultSchema,
  TeamMemberRowSchema,
  TeamTableResponseSchema,
} from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { CompanyMemberService } from './company-member.service';
import { CompanyMemberListQueryDto } from './dto/company-member-list-query.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { TeamTableQueryDto } from './dto/team-table-query.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { Roles, UserScoped } from '@auth';

@ApiTags('Company members')
@ApiCookieAuth('access_token')
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

  @Post('table')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Team table: rows, load, live presence and company counts' })
  @ZodSerializerDto(TeamTableResponseSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TeamTableResponseSchema) })
  table(@Body() query: TeamTableQueryDto) {
    return this.service.table(query);
  }

  @Post()
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Add a member: links, creates or restores the account' })
  @ZodSerializerDto(CreateMemberResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CreateMemberResultSchema) })
  create(@Body() body: CreateMemberDto) {
    return this.service.create(body);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Edit role, status, auto-assign, capacity or identity' })
  @ZodSerializerDto(TeamMemberRowSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TeamMemberRowSchema) })
  update(@Param('id') id: string, @Body() body: UpdateMemberDto) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Remove a member; its open conversations go back to the queue' })
  @ZodSerializerDto(RemoveMemberResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(RemoveMemberResultSchema) })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Generate a new password (shown once) and revoke sessions' })
  @ZodSerializerDto(ResetMemberPasswordResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ResetMemberPasswordResultSchema) })
  resetPassword(@Param('id') id: string) {
    return this.service.resetPassword(id);
  }
}
