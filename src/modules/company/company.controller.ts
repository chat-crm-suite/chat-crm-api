// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateAssignmentSettingsDto } from './dto/assignment-settings.dto';
import { UserScoped } from '@auth';

/**
 * `me/*` routes act on the active company (tenant guard); the rest are
 * platform-level and only need a session.
 */
@Controller('company')
export class CompanyController {
  constructor(
    private readonly service: CompanyService,
  ) { }

  @UserScoped()
  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.service.create(createCompanyDto);
  }

  @UserScoped()
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('me')
  me() {
    return this.service.info;
  }

  /** Config de asignación automática de la empresa activa (Q18). */
  @Get('me/assignment-settings')
  assignmentSettings() {
    return this.service.getAssignmentSettings();
  }

  @Patch('me/assignment-settings')
  updateAssignmentSettings(@Body() dto: UpdateAssignmentSettingsDto) {
    return this.service.updateAssignmentSettings(dto);
  }

  @UserScoped()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
  //   return this.service.update(+id, updateCompanyDto);
  // }

  @UserScoped()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(+id);
  }
}
