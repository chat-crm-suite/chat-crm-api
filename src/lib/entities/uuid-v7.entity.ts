import { BeforeInsert, PrimaryColumn } from 'typeorm';

import { uuidv7 } from '../helpers/uuid.helper';

/**
 * Base for v2 tables: `id` is a `char(36)` UUIDv7 generated app-side
 * (time-ordered, unlike TypeORM's v4 default).
 *
 * `message_status_events` does NOT extend this class: its PK is a `bigint`
 * auto-increment (append-only table).
 */
export abstract class UuidV7Entity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @BeforeInsert()
  protected ensureId(): void {
    if (!this.id) {
      this.id = uuidv7();
    }
  }
}
