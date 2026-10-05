import { Injectable } from '@nestjs/common';
import { startOfMonth, subMonths } from 'date-fns';
import { DataSource } from 'typeorm';
import { AgentQuery, ClientQuery, ContactQuery } from './metrics.interface';
import { period, PeriodTime } from '../../lib/period';
import { ANALYSIS_LABEL_BY_METRIC } from './repositories/sentiment.repository';
import type { SentimentType, Table } from './metrics.types';

export type { SentimentType } from './metrics.types';

type ComparePeriodsParams = {
  targetTable: Table;
  column: string;
  timeUnit: PeriodTime;
  timeColumn?: string;
};
type CompareParams = {
  target: Table;
  column: string;
  period: PeriodTime;
  timeColumn?: string;
};

@Injectable()
export class MetricsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async comparePeriod(filters: CompareParams, whereClause?: string) {
    const curr = period(filters.period);
    const prev = period(filters.period, 1);
    const timeColumn = filters.timeColumn ?? 'created_at';

    const raw: { current: string; previous: string }[] = await this.dataSource
      .sql`
      SELECT 
        COUNT(DISTINCT CASE WHEN ${() => timeColumn} BETWEEN ${curr.start} AND ${curr.end} THEN ${() => filters.column} END) AS current,
        COUNT(DISTINCT CASE WHEN ${() => timeColumn} BETWEEN ${prev.start} AND ${prev.end} THEN ${() => filters.column} END) AS previous
      FROM ${() => filters.target}
      WHERE ${() => filters.column} IS NOT NULL
        AND (${() => whereClause ?? '1=1'});
    `;

    return {
      current: parseInt(raw[0].current) || 0,
      previous: parseInt(raw[0].previous) || 0,
    };
  }

  async comparePeriods({
    targetTable,
    column = 'id',
    timeUnit,
    timeColumn = 'created_at',
  }: ComparePeriodsParams) {
    const currentPeriod = period(timeUnit);
    const previousPeriod = period(timeUnit, 1);

    const currentStart = currentPeriod.start.toISOString();
    const currentEnd = currentPeriod.end.toISOString();
    const previousStart = previousPeriod.start.toISOString();
    const previousEnd = previousPeriod.end.toISOString();

    const raw: { current: string; previous: string }[] = await this.dataSource
      .sql`
      SELECT (
        SELECT COUNT(DISTINCT(${() => column})) FROM ${() => targetTable}
        WHERE ${() => timeColumn} BETWEEN ${currentStart} AND ${currentEnd} 
        AND ${() => column} IS NOT NULL
      ) as current, (
        SELECT COUNT(DISTINCT(${() => column})) FROM ${() => targetTable}
        WHERE ${() => timeColumn} BETWEEN ${previousStart} AND ${previousEnd} 
        AND ${() => column} IS NOT NULL
      ) as previous
    `;

    return {
      current: parseInt(raw[0].current) || 0,
      previous: parseInt(raw[0].previous) || 0,
    };
  }

  async getTopContacts(limit = 5) {
    const now = new Date();
    const start = startOfMonth<Date>(subMonths(now, 2));

    const results: ContactQuery[] = await this.dataSource.sql`
        SELECT 
          c.id,
          c.display_name AS username,
          c.first_name AS firstNames,
          c.last_name AS lastNames,
          c.phone_number AS phoneNumber,
          c.display_name AS profile,
          COUNT(m.id) AS count,
          RANK() OVER (ORDER BY COUNT(m.id) DESC) AS \`rank\`
        FROM messages m
        INNER JOIN customers c ON m.sender_customer_id = c.id
        WHERE m.direction = 'inbound'
        AND m.created_at >= ${start}
        GROUP BY c.id
        ORDER BY count DESC, c.display_name
        LIMIT ${limit}`;

    return results; // MySQL returns COUNT(*) directly as a number
  }

  async getAgentsFast(
    label: SentimentType,
    limit: number = 5,
  ): Promise<AgentQuery[]> {
    const storedLabel = ANALYSIS_LABEL_BY_METRIC[label];

    const qb: AgentQuery[] = await this.dataSource.sql`
      SELECT 
        u.id AS id,
        u.username AS username,
        u.first_name AS firstName,
        u.last_name AS lastName,
        COUNT(sr.analysis_id) AS total,
        AVG(sr.score_positive) AS avgPos,
        AVG(sr.score_neutral) AS avgNeu,
        AVG(sr.score_negative) AS avgNeg
      FROM messages m
      INNER JOIN company_members cm ON cm.id = m.sender_member_id
      INNER JOIN users u ON u.id = cm.user_id
      INNER JOIN analyses a ON a.message_id = m.id
      INNER JOIN sentiment_results sr ON sr.analysis_id = a.id
      WHERE m.direction = 'outbound'
        AND sr.label = ${storedLabel}
      GROUP BY u.id
      ORDER BY total DESC
      LIMIT ${limit}
    `;

    return qb;
  }

  async getBestClients(
    userId: string,
    label: SentimentType = 'POS',
    limit: number = 5,
  ): Promise<ClientQuery[]> {
    const storedLabel = ANALYSIS_LABEL_BY_METRIC[label];

    const qb: ClientQuery[] = await this.dataSource.sql`
      SELECT 
        c.id AS contactId,
        COALESCE(c.display_name, NULLIF(CONCAT_WS(' ', c.first_name, c.last_name), '')) AS username,
        COUNT(m.id) AS totalMessages,
        AVG(sr.score_positive) AS avgPos,
        COUNT(sr.analysis_id) AS totalPositive,
        COUNT(m.id) * AVG(sr.score_positive) AS score
      FROM messages m
      INNER JOIN conversations conv ON conv.id = m.conversation_id
      INNER JOIN company_members cm ON cm.id = conv.assigned_member_id
      INNER JOIN customers c ON c.id = m.sender_customer_id
      LEFT JOIN analyses a ON a.message_id = m.id AND a.type = 'sentiment'
      LEFT JOIN sentiment_results sr ON sr.analysis_id = a.id AND sr.label = ${storedLabel}
      WHERE cm.user_id = ${userId}
        AND m.direction = 'inbound'
      GROUP BY c.id
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    return qb;
  }
}
