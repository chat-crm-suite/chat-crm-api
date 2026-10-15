// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Body, Patch, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { createZodDto, ZodSerializerDto } from 'nestjs-zod';
import { CompanyService } from './company.service';
import { UpdateAssignmentSettingsDto } from './dto/assignment-settings.dto';
import {
  AssignmentSettingsResponseDto,
  CompanyProfileResponseDto,
  UpdateCompanyProfileDto,
} from './dto/company-profile.dto';
import { CurrentTenant, Roles } from '@auth';
import {
  AssignmentSettingsSchema,
  CompanyProfileSchema,
  ServiceSettingsSchema,
  UpdateServiceSettingsSchema,
} from '@contracts';
import {
  ServiceSettingsService,
  toPublicSettings,
} from './service-settings/service-settings.service';

export class UpdateServiceSettingsDto extends createZodDto(UpdateServiceSettingsSchema) {}
export class ServiceSettingsResponseDto extends createZodDto(ServiceSettingsSchema) {}

/**
 * Everything here acts on the active company (tenant guard). Creating,
 * listing and deleting companies is the platform console job
 * (`/platform/companies`), not this controller.
 */
@Controller('company')
export class CompanyController {
  constructor(
    private readonly service: CompanyService,
    private readonly serviceSettings: ServiceSettingsService,
  ) { }

  @Get('me')
  @ApiOperation({ summary: 'Profile of the active company' })
  @ZodSerializerDto(CompanyProfileSchema)
  @ApiOkResponse({ type: CompanyProfileResponseDto })
  me() {
    return this.service.profile();
  }

  @Patch('me')
  @Roles('admin')
  @ApiOperation({ summary: 'Update the active company data (admin)' })
  @ZodSerializerDto(CompanyProfileSchema)
  @ApiOkResponse({ type: CompanyProfileResponseDto })
  updateMe(@Body() dto: UpdateCompanyProfileDto) {
    return this.service.updateProfile(dto);
  }

  /** Config de asignación automática de la empresa activa (Q18). */
  @Get('me/assignment-settings')
  @ApiOperation({ summary: 'Automatic assignment settings of the active company' })
  @ZodSerializerDto(AssignmentSettingsSchema)
  @ApiOkResponse({ type: AssignmentSettingsResponseDto })
  assignmentSettings() {
    return this.service.getAssignmentSettings();
  }

  @Patch('me/assignment-settings')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Update automatic assignment settings (admin, supervisor)' })
  @ZodSerializerDto(AssignmentSettingsSchema)
  @ApiOkResponse({ type: AssignmentSettingsResponseDto })
  updateAssignmentSettings(@Body() dto: UpdateAssignmentSettingsDto) {
    return this.service.updateAssignmentSettings(dto);
  }

  /** Business hours + first-response SLA of the active company. */
  @Get('service-settings')
  @ApiOperation({ summary: 'Business hours and SLA of the active company' })
  @ZodSerializerDto(ServiceSettingsSchema)
  @ApiOkResponse({ type: ServiceSettingsResponseDto })
  async getServiceSettings(@CurrentTenant('companyId') companyId: string) {
    return toPublicSettings(await this.serviceSettings.get(companyId));
  }

  @Put('service-settings')
  @Roles('admin')
  @ApiOperation({ summary: 'Update business hours and SLA (admin)' })
  @ZodSerializerDto(ServiceSettingsSchema)
  @ApiOkResponse({ type: ServiceSettingsResponseDto })
  updateServiceSettings(
    @CurrentTenant('companyId') companyId: string,
    @Body() dto: UpdateServiceSettingsDto,
  ) {
    return this.serviceSettings.update(companyId, dto);
  }
}
