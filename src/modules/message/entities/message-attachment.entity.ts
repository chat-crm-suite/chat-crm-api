// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
} from 'typeorm';

import type {
  AttachmentStatus,
  AttachmentType,
} from '../../../contracts/index';
import { UuidV7Entity } from '../../../lib/entities/uuid-v7.entity';
import { Message } from './message.entity';

/** Replaces `messages.media_url`; one message can carry several files. */
@Entity('message_attachments')
export class MessageAttachment extends UuidV7Entity {
  @Column({ name: 'message_id', type: 'varchar', length: 36 })
  messageId: string;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  @Column({ type: 'varchar', length: 50 })
  type: AttachmentType;

  @Column({ name: 'mime_type', length: 100 })
  mimeType: string;

  @Column({ name: 'file_name', length: 255, nullable: true })
  fileName?: string;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value,
      from: (value?: string | null) =>
        value === null || value === undefined ? value : Number(value),
    },
  })
  sizeBytes?: number | null;

  @Column({ name: 'storage_url', length: 1024, nullable: true })
  storageUrl?: string;

  @Column({ name: 'external_media_id', length: 128, nullable: true })
  externalMediaId?: string;

  /** T3: `pending` until the async enrichment stores or fails the file. */
  @Column({ type: 'varchar', length: 32, default: 'ready' })
  status: AttachmentStatus;

  @Column({ type: 'int', nullable: true })
  width?: number | null;

  @Column({ type: 'int', nullable: true })
  height?: number | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
