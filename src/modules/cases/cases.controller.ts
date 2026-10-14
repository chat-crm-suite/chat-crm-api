// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '../../auth/index';
import type { TenantContext } from '../../auth/index';
import { CLS_USER_ID } from '../../config/cls.keys';
import { CaseSchema, CloseCaseSchema, CurrentCaseSchema } from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { AnalyticsSignalEvent } from '../analytics/events/analytics.events';
import { ConversationAccessService } from '../conversations/realtime/conversation-access.service';
import { CasesService } from './cases.service';
import type { Case } from './entities/case.entity';

export class CloseCaseDto extends createZodDto(CloseCaseSchema) {}

/**
 * Case endpoints under the conversation they belong to. Same access rules as
 * reading the thread: the conversation is in the active company and the role
 * reaches it (agents: own or queued conversations).
 */
@ApiTags('Cases')
@Controller('conversations')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly access: ConversationAccessService,
    private readonly eventBus: EventBus,
    private readonly cls: ClsService,
  ) {}

  @Get(':id/case')
  @ApiOperation({ summary: 'Latest support case of the conversation' })
  @ZodSerializerDto(CurrentCaseSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CurrentCaseSchema) })
  async current(@Param('id') id: string, @CurrentTenant() tenant: TenantContext) {
    await this.assertAccess(id, tenant);
    const latest = await this.cases.findLatest(id);
    return { case: latest ? toCase(latest) : null };
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close the open support case of the conversation' })
  @ZodSerializerDto(CaseSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CaseSchema) })
  async close(
    @Param('id') id: string,
    @Body() body: CloseCaseDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    await this.assertAccess(id, tenant);
    const closed = await this.cases.close(id, tenant.memberId, body.note);
    this.eventBus.publish(new AnalyticsSignalEvent(tenant.companyId, ['live', 'cases']));
    return toCase(closed);
  }

  private assertAccess(conversationId: string, tenant: TenantContext) {
    return this.access.assertCanJoinConversation(conversationId, {
      userId: this.cls.get<string>(CLS_USER_ID) ?? null,
      companyId: tenant.companyId,
      authenticated: true,
    });
  }
}

const toCase = (row: Case) => ({
  id: row.id,
  conversationId: row.conversationId,
  status: row.status,
  openedAt: row.openedAt,
  firstResponseAt: row.firstResponseAt ?? null,
  firstResponderMemberId: row.firstResponderMemberId ?? null,
  closedAt: row.closedAt ?? null,
  closedByMemberId: row.closedByMemberId ?? null,
  reopenOfCaseId: row.reopenOfCaseId ?? null,
});
