// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
  ConversationNoteSchema,
  StartConversationSchema,
  TransferConversationSchema,
  UpdateConversationPrioritySchema,
} from '@contracts';
import { createDatedZodDto } from '@docs/dated-zod-dto';

export class ConversationNoteDto extends createZodDto(ConversationNoteSchema) {}

export class TransferConversationDto extends createZodDto(TransferConversationSchema) {}

export class StartConversationDto extends createDatedZodDto(
  StartConversationSchema,
  StartConversationSchema.extend({
    task: StartConversationSchema.shape.task
      .unwrap()
      .extend({ dueAt: z.iso.datetime().optional() })
      .optional(),
  }),
) {}

export class UpdateConversationPriorityDto extends createZodDto(UpdateConversationPrioritySchema) {}
