import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  ChannelResponseSchema,
  WhatsAppConfigResponseSchema,
} from '../../contracts/index';
import { JwtAuthGuard } from '../../auth/guards/index';
import { CompanyGuard } from '../company/company.guard';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';

@ApiTags('Channels')
@ApiCookieAuth('access_token')
@Controller('channels')
@UseGuards(JwtAuthGuard, CompanyGuard)
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

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
