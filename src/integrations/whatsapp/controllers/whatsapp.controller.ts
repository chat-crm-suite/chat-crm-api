import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  CreateWhatsAppConfigDto,
  UpdateWhatsAppConfigDto,
  WhatsAppConfigResponseDto,
} from '../dto/whatsapp-config.dto';
import { WhatsAppConfigSchema } from '../../../contracts/index';
import { JwtAuthGuard } from '../../../auth/guards/index';
import { CompanyGuard } from '../../../modules/company/company.guard';
import { WhatsAppService } from '../whatsapp.service';
import { WhatsAppExceptionFilter } from '../filters/whatsapp-exception.filter';

@ApiTags('WhatsApp')
@ApiCookieAuth('access_token')
@Controller('integration/whatsapp')
@UseGuards(JwtAuthGuard, CompanyGuard)
@UseFilters(new WhatsAppExceptionFilter())
export class WhatsappController {
  constructor(private readonly service: WhatsAppService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Get the WhatsApp configuration of the active company',
  })
  @ApiOkResponse({ type: WhatsAppConfigResponseDto })
  @ZodSerializerDto(WhatsAppConfigSchema.nullable())
  getConfig() {
    return this.service.getConfig();
  }

  @Get('config/validate')
  @ApiOperation({
    summary: 'Validate the WhatsApp configuration of the active company',
  })
  @ApiOkResponse({ type: WhatsAppConfigResponseDto })
  @ZodSerializerDto(WhatsAppConfigSchema.nullable())
  validateConfig() {
    return this.service.getConfig();
  }

  @Post()
  @ApiOperation({ summary: 'Create a WhatsApp configuration' })
  @ApiCreatedResponse({ type: WhatsAppConfigResponseDto })
  @ZodSerializerDto(WhatsAppConfigSchema)
  create(@Body() dto: CreateWhatsAppConfigDto) {
    return this.service.createConfig(dto);
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update the WhatsApp configuration' })
  @ApiOkResponse({ type: WhatsAppConfigResponseDto })
  @ZodSerializerDto(WhatsAppConfigSchema.nullable())
  update(@Body() dto: UpdateWhatsAppConfigDto) {
    return this.service.updateConfig(dto);
  }
}
