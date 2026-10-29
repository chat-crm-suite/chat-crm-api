// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time normalization of the pre-UTC storage era.
 *
 * Before this migration the mysql2 driver ran with `timezone: 'local'`, i.e.
 * on the `APP_TZ` clock (default `America/Lima`, UTC-5). Dates written from
 * JS (`new Date()`, provider epochs, client inputs) were therefore stored as
 * Lima wall-clock, while `created_at`/`updated_at` (DB defaults) were already
 * UTC. The driver is now pinned to UTC, so shift the JS-written columns +5h.
 *
 * Columns that mirror a `message.createdAt`/`updated_at` (already UTC) are
 * left alone; `opened_at` is mixed, so only the rows that are clearly on the
 * Lima clock are shifted.
 */
export class UtcNormalizeDatetimes1792100000000 implements MigrationInterface {
  name = 'UtcNormalizeDatetimes1792100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const shift = (table: string, column: string) =>
      queryRunner.query(
        `UPDATE \`${table}\` SET \`${column}\` = DATE_ADD(\`${column}\`, INTERVAL 5 HOUR) WHERE \`${column}\` IS NOT NULL`,
      );

    await shift('users', 'last_login_at');
    await shift('channels', 'status_changed_at');
    await shift('message_templates', 'synced_at');
    await shift('messages', 'sent_at');
    await shift('messages', 'status_updated_at');
    await shift('message_status_events', 'occurred_at');
    await shift('notifications', 'read_at');
    await shift('tasks', 'due_at');
    await shift('tasks', 'completed_at');
    await shift('analyses', 'completed_at');
    await shift('analyses', 'next_retry_at');
    await shift('conversations', 'closed_at');
    await shift('conversation_assignments', 'assigned_at');
    await shift('conversation_assignments', 'unassigned_at');
    await shift('conversation_reads', 'last_read_at');
    await shift('presence_intervals', 'started_at');
    await shift('presence_intervals', 'ended_at');
    await shift('channel_charges', 'occurred_at');
    await shift('customers', 'last_interaction_at');
    await shift('cases', 'closed_at');

    await queryRunner.query(
      `UPDATE \`cases\` SET \`opened_at\` = DATE_ADD(\`opened_at\`, INTERVAL 5 HOUR) WHERE \`opened_at\` < DATE_SUB(\`created_at\`, INTERVAL 1 HOUR)`,
    );
  }

  async down(): Promise<void> {
    // Not reversible: the Lima/UTC mix can no longer be reconstructed.
  }
}
