// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  CONNECTION_CHECK,
  ChannelResponseSchema,
  WhatsAppConfigResponseSchema,
  WhatsAppConnectionTestSchema,
  type WhatsAppConnectionTest,
} from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { WhatsAppConnectionTester } from './whatsapp-connection.tester';

@ApiTags('Channels')
@ApiCookieAuth('access_token')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly service: ChannelsService,
    private readonly tester: WhatsAppConnectionTester,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the channels of the active company' })
  list() {
    return this.service.list();
  }

  @Get('whatsapp/config')
  @ApiOperation({
    summary: 'Get the WhatsApp channel of the active company',
  })
  @ZodSerializerDto(WhatsAppConfigResponseSchema.nullable())
  getWhatsAppConfig() {
    return this.service.getWhatsAppConfigWithToken();
  }

  @Get('whatsapp/config/validate')
  @ApiOperation({
    summary: 'Validate the WhatsApp channel of the active company',
  })
  @ZodSerializerDto(ChannelResponseSchema.nullable())
  validateConfig() {
    return this.service.getWhatsAppConfig();
  }

  @Post('whatsapp/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test the WhatsApp channel of the active company',
    description:
      'Checks sending (phone number ID + access token against Graph), the stored webhook URL (Meta verification handshake) and the Meta app subscription. Always 200; each check reports ok/failed/skipped.',
  })
  @ZodSerializerDto(WhatsAppConnectionTestSchema)
  @ApiOkResponse({ schema: zodResponseSchema(WhatsAppConnectionTestSchema) })
  async test(): Promise<WhatsAppConnectionTest> {
    const target = await this.service.getWhatsAppTestTarget();
    if (target) {
      const { credentialsRejected, ...result } = await this.tester.test(
        target.channel,
        target.credentials,
      );
      // The test is the way back up (and an early way down): same status the
      // inbox reads, pushed live by `channel:status:changed`.
      if (credentialsRejected) {
        await this.service.markChannelDown(target.channel.id, result.sending.message);
      } else if (result.sending.status === CONNECTION_CHECK.ok) {
        await this.service.markChannelUp(target.channel.id);
      }
      return result;
    }

    const missing = {
      status: CONNECTION_CHECK.skipped,
      message: 'La empresa no tiene canal de WhatsApp.',
    };
    return { ok: false, sending: missing, webhook: missing, subscription: missing };
  }

  @Post()
  @ApiOperation({ summary: 'Create a channel' })
  @ZodSerializerDto(ChannelResponseSchema)
  create(@Body() dto: CreateChannelDto) {
    return this.service.create(dto);
  }

  @Patch('whatsapp/config')
  @ApiOperation({ summary: 'Update the WhatsApp channel' })
  @ZodSerializerDto(ChannelResponseSchema.nullable())
  update(@Body() dto: UpdateChannelDto) {
    return this.service.updateWhatsAppConfig(dto);
  }
}
