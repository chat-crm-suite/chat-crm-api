// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '@auth/decorators/current-tenant.decorator';
import type { TenantContext } from '@auth/auth.types';
import { CLS_USER_ID } from '@config/cls.keys';
import {
  ConversationLifecycleResultSchema,
  ConversationListItemSchema,
} from '@contracts';
import { zodResponseSchema } from '@docs/zod-response';
import {
  ConversationNoteDto,
  TransferConversationDto,
  UpdateConversationPriorityDto,
} from '../dto/conversation-note.dto';
import {
  ConversationLifecycleService,
  type LifecycleActor,
} from './conversation-lifecycle.service';

/**
 * Lifecycle actions on one conversation. Each answers the resulting state
 * (`ConversationLifecycleResultSchema`) so the UI updates without a refetch.
 */
@ApiTags('Conversations')
@ApiCookieAuth('access_token')
@Controller('conversations')
export class ConversationLifecycleController {
  constructor(
    private readonly lifecycle: ConversationLifecycleService,
    private readonly cls: ClsService,
  ) {}

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve: close the case and release the owner' })
  @ZodSerializerDto(ConversationLifecycleResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationLifecycleResultSchema) })
  resolve(
    @Param('id') id: string,
    @Body() body: ConversationNoteDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.resolve(id, this.actor(tenant), body.note);
  }

  @Post(':id/pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put on hold (waiting on the customer)' })
  @ZodSerializerDto(ConversationLifecycleResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationLifecycleResultSchema) })
  pending(
    @Param('id') id: string,
    @Body() _body: ConversationNoteDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.setPending(id, this.actor(tenant));
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a resolved or on-hold conversation' })
  @ZodSerializerDto(ConversationLifecycleResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationLifecycleResultSchema) })
  reopen(
    @Param('id') id: string,
    @Body() _body: ConversationNoteDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.reopen(id, this.actor(tenant));
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release the conversation back to the queue' })
  @ZodSerializerDto(ConversationLifecycleResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationLifecycleResultSchema) })
  release(
    @Param('id') id: string,
    @Body() body: ConversationNoteDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.release(id, this.actor(tenant), body.note);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer the conversation to another member, with a note' })
  @ZodSerializerDto(ConversationLifecycleResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationLifecycleResultSchema) })
  transfer(
    @Param('id') id: string,
    @Body() body: TransferConversationDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.transfer(id, this.actor(tenant), body);
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: 'Set or clear the priority of a conversation' })
  @ZodSerializerDto(ConversationListItemSchema)
  @ApiOkResponse({ schema: zodResponseSchema(ConversationListItemSchema) })
  priority(
    @Param('id') id: string,
    @Body() body: UpdateConversationPriorityDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.lifecycle.setPriority(id, this.actor(tenant), body.priority);
  }

  private actor(tenant: TenantContext): LifecycleActor {
    return { ...tenant, userId: this.cls.get<string>(CLS_USER_ID) ?? null };
  }
}
