// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';

import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import type { TenantContext } from '../../auth/auth.types';
import { TaskSchema, WorkQueueResponseSchema } from '../../contracts/index';
import { zodResponseSchema } from '../../docs/zod-response';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { WorkQueueQueryDto } from './dto/work-queue-query.dto';
import { TasksService } from './tasks.service';
import { WorkQueueService } from './work-queue.service';

/**
 * Manual tasks. Agents see and edit only their own and create tasks for
 * themselves; admin/supervisor see the company (`scope=all`) and assign to
 * anyone.
 */
@ApiTags('Tasks')
@ApiCookieAuth('access_token')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Tasks (mine, or all for admin/supervisor)' })
  @ZodSerializerDto(TaskSchema.array())
  @ApiOkResponse({ schema: zodResponseSchema(TaskSchema.array()) })
  list(@Query() query: ListTasksQueryDto, @CurrentTenant() tenant: TenantContext) {
    return this.tasks.list(tenant, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a task (for someone else: admin/supervisor)' })
  @ZodSerializerDto(TaskSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TaskSchema) })
  create(@Body() body: CreateTaskDto, @CurrentTenant() tenant: TenantContext) {
    return this.tasks.create(tenant, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit, reassign or change the status of a task' })
  @ZodSerializerDto(TaskSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TaskSchema) })
  update(
    @Param('id') id: string,
    @Body() body: UpdateTaskDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.tasks.update(tenant, id, body);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a task as done' })
  @ZodSerializerDto(TaskSchema)
  @ApiOkResponse({ schema: zodResponseSchema(TaskSchema) })
  complete(@Param('id') id: string, @CurrentTenant() tenant: TenantContext) {
    return this.tasks.complete(tenant, id);
  }
}

/** "Mi trabajo": open tasks plus derived signals and badge counts. */
@ApiTags('Tasks')
@ApiCookieAuth('access_token')
@Controller('work-queue')
export class WorkQueueController {
  constructor(private readonly workQueue: WorkQueueService) {}

  @Get()
  @ApiOperation({ summary: 'Open tasks, live signals and counts of the caller (or team)' })
  @ZodSerializerDto(WorkQueueResponseSchema)
  @ApiOkResponse({ schema: zodResponseSchema(WorkQueueResponseSchema) })
  get(@Query() query: WorkQueueQueryDto, @CurrentTenant() tenant: TenantContext) {
    return this.workQueue.get(tenant, query);
  }
}
