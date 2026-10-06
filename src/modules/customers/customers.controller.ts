// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';

import { CustomerTableQueryDto } from '../../common/schemas/customer-table-query.schema';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@Controller('customers')
@UseGuards(AuthGuard('jwt'))
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.customersService.importCsv(file);
  }

  @Post('table')
  getTable(@Body() query: CustomerTableQueryDto) {
    return this.customersService.table(query);
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.customersService.search(q);
  }

  @Get()
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':phone')
  findByPhone(@Param('phone') phone: string) {
    return this.customersService.findByPhone(phone);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
