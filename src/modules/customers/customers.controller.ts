// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import {
  BulkDeleteCustomersResultSchema,
  CustomerImportResultSchema,
  CustomerMutationResultSchema,
  CustomerResponseSchema,
  CustomerRowSchema,
  paginatedSchema,
  PipelineStageSchema,
  TagSchema,
} from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { CustomersService } from './customers.service';
import {
  BulkDeleteCustomersDto,
  CreateCustomerDto,
  CreateTagDto,
  CustomerTableQueryDto,
  SetCustomerTagsDto,
  UpdateCustomerDto,
} from './dto/customer.dto';
import { Roles } from '@auth';

const CustomerPageSchema = paginatedSchema(CustomerRowSchema);

/**
 * Customers of the active company. Static routes (`table`, `search`, `stages`, `tags`,
 * `import`, `bulk-delete`) come before the `:phone` / `:id` ones.
 */
@ApiTags('Customers')
@ApiCookieAuth('access_token')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a customer; a deleted one with the same phone is restored' })
  @ZodSerializerDto(CustomerMutationResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CustomerMutationResultSchema) })
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Import customers from a CSV (created, restored, skipped)' })
  @ZodSerializerDto(CustomerImportResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CustomerImportResultSchema) })
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.customersService.importCsv(file);
  }

  @Post('table')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customers table with owner, stage, tags and conversations' })
  @ZodSerializerDto(CustomerPageSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CustomerPageSchema) })
  getTable(@Body() query: CustomerTableQueryDto) {
    return this.customersService.table(query);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Soft delete several customers of the company' })
  @ZodSerializerDto(BulkDeleteCustomersResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(BulkDeleteCustomersResultSchema) })
  bulkDelete(@Body() body: BulkDeleteCustomersDto) {
    return this.customersService.bulkDelete(body.ids);
  }

  @Get('search')
  @ApiOperation({ summary: 'Quick search by name, phone or email (10 results)' })
  @ZodSerializerDto(CustomerResponseSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(CustomerResponseSchema.array()) })
  search(@Query('q') q: string) {
    return this.customersService.search(q);
  }

  @Get('stages')
  @ApiOperation({ summary: 'Pipeline stages of the company, ordered by position' })
  @ZodSerializerDto(PipelineStageSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(PipelineStageSchema.array()) })
  listStages() {
    return this.customersService.listStages();
  }

  @Get('tags')
  @ApiOperation({ summary: 'Tags of the company' })
  @ZodSerializerDto(TagSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(TagSchema.array()) })
  listTags() {
    return this.customersService.listTags();
  }

  @Post('tags')
  @ApiOperation({ summary: 'Create a tag (409 when the name exists)' })
  @ZodSerializerDto(TagSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TagSchema) })
  createTag(@Body() body: CreateTagDto) {
    return this.customersService.createTag(body);
  }

  @Get()
  @ZodSerializerDto(CustomerResponseSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(CustomerResponseSchema.array()) })
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':phone')
  @ZodSerializerDto(CustomerResponseSchema.nullable())
  @ApiOkResponse({ schema: zodResponseSchema(CustomerResponseSchema.nullable()) })
  findByPhone(@Param('phone') phone: string) {
    return this.customersService.findByPhone(phone);
  }

  @Put(':id/tags')
  @ApiOperation({ summary: 'Replace the tags of a customer' })
  @ZodSerializerDto(CustomerRowSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CustomerRowSchema) })
  setTags(@Param('id') id: string, @Body() body: SetCustomerTagsDto) {
    return this.customersService.setTags(id, body);
  }

  @Patch(':id')
  @ZodSerializerDto(CustomerMutationResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(CustomerMutationResultSchema) })
  update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  @ApiOperation({ summary: 'Soft delete a customer' })
  @ZodSerializerDto(BulkDeleteCustomersResultSchema)
  @ApiOkResponse({ schema: zodResponseSchema(BulkDeleteCustomersResultSchema) })
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
