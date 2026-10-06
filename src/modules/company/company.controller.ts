// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateAssignmentSettingsDto } from './dto/assignment-settings.dto';
import { CompanyGuard } from './company.guard';
import { JwtAuthGuard } from '../../auth/guards';

@Controller('company')
@UseGuards(JwtAuthGuard)
export class CompanyController {
  constructor(
    private readonly service: CompanyService,
  ) { }

  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.service.create(createCompanyDto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('me')
  @UseGuards(CompanyGuard)
  me() {
    return this.service.info;
  }

  /** Config de asignación automática de la empresa activa (Q18). */
  @Get('me/assignment-settings')
  @UseGuards(CompanyGuard)
  assignmentSettings() {
    return this.service.getAssignmentSettings();
  }

  @Patch('me/assignment-settings')
  @UseGuards(CompanyGuard)
  updateAssignmentSettings(@Body() dto: UpdateAssignmentSettingsDto) {
    return this.service.updateAssignmentSettings(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
  //   return this.service.update(+id, updateCompanyDto);
  // }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(+id);
  }
}
