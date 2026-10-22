// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Body, Controller, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '@auth/decorators/current-tenant.decorator';
import type { TenantContext } from '@auth/auth.types';
import { CLS_USER_ID } from '@config/cls.keys';
import { StartConversationResultSchema } from '@contracts';
import { zodResponseSchema } from '@docs/zod-response';
import { StartConversationDto } from '../dto/conversation-note.dto';
import { ConversationStartService } from './conversation-start.service';

@ApiTags('Conversations')
@ApiCookieAuth('access_token')
@Controller('conversations')
export class ConversationStartController {
  constructor(
    private readonly starter: ConversationStartService,
    private readonly cls: ClsService,
  ) {}

  /**
   * "Nuevo chat": open or reuse the customer's conversation on a channel,
   * assign it, optionally add a task and send a template (required when the
   * reply window is closed: 409 `reply_window_closed`).
   */
  @Post('start')
  @ApiOperation({ summary: 'Start (or reuse) a conversation with a customer' })
  @ZodSerializerDto(StartConversationResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(StartConversationResultSchema) })
  start(@Body() body: StartConversationDto, @CurrentTenant() tenant: TenantContext) {
    return this.starter.start(
      { ...tenant, userId: this.cls.get<string>(CLS_USER_ID) ?? null },
      body,
    );
  }
}
