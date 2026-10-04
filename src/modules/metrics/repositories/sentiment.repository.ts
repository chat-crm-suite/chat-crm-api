import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { SentimentLabel } from '../../../contracts/index';
import { SentimentType } from '../metrics.types';
import { SentimentTopQuery, TrendPeriodQuery } from '../metrics.interface';
import { period, PeriodTime } from '../../../lib/period';
import { DATE_FORMAT_SQL } from '../constants/metrics.constants';

/**
 * Metrics queries use the short labels (POS/NEU/NEG) while
 * `sentiment_results.label` stores the analysis contract labels (long form).
 * Bridge both directions at the repository boundary.
 */
const ANALYSIS_LABEL_BY_METRIC: Record<SentimentType, SentimentLabel> = {
  POS: 'positive',
  NEU: 'neutral',
  NEG: 'negative',
};

@Injectable()
export class SentimentRepository {
  constructor(private readonly dataSource: DataSource) {}

  async trendPeriod(
    periodTime: PeriodTime,
    userId?: string,
  ): Promise<TrendPeriodQuery[]> {
    // === Period setup ===
    const { start, end } = period(periodTime);

    // === Query execution ===
    const query: Promise<TrendPeriodQuery[]> = this.dataSource.sql`
      SELECT 
        DATE_FORMAT(m.created_at, ${DATE_FORMAT_SQL[periodTime]}) as date,
        AVG(sr.score_positive) as avg_pos,
        AVG(sr.score_neutral) as avg_neu,
        AVG(sr.score_negative) as avg_neg 
      FROM sentiment_results sr 
      INNER JOIN analyses a ON a.id = sr.analysis_id
      INNER JOIN messages m ON m.id = a.message_id 
      LEFT JOIN company_members cm ON cm.id = m.sender_member_id
      WHERE m.created_at BETWEEN ${start} AND ${end}
        AND cm.user_id = COALESCE(${userId}, cm.user_id)
      GROUP BY date
      ORDER By date
    `;

    return query;
  }

  async topAgent(
    label?: SentimentType,
    limit: number = 5,
  ): Promise<SentimentTopQuery[]> {
    const storedLabel = label ? ANALYSIS_LABEL_BY_METRIC[label] : null;

    return this.dataSource.sql`
      SELECT 
        u.id AS id,
        u.username AS username,
        COUNT(sr.analysis_id) AS total,
        COALESCE(${label ?? null}, sr.label) AS label,
        AVG(sr.score_positive) AS avgPos,
        AVG(sr.score_neutral) AS avgNeu,
        AVG(sr.score_negative) AS avgNeg
      FROM messages m
      INNER JOIN company_members cm ON cm.id = m.sender_member_id -- agent relation
      INNER JOIN users u ON u.id = cm.user_id
      INNER JOIN analyses a ON a.message_id = m.id
      INNER JOIN sentiment_results sr ON sr.analysis_id = a.id
      WHERE 
        sr.label = COALESCE(${storedLabel}, sr.label) AND 
        m.direction = 'outbound' AND
        m.sender_member_id IS NOT NULL
      GROUP BY u.id, sr.label
      ORDER BY total DESC
      LIMIT ${limit}
    `;
  }

  async topClient(
    label?: SentimentType,
    limit: number = 5,
  ): Promise<SentimentTopQuery[]> {
    const storedLabel = label ? ANALYSIS_LABEL_BY_METRIC[label] : null;

    return this.dataSource.sql`
      SELECT 
        c.id AS id,
        COALESCE(c.display_name, NULLIF(CONCAT_WS(' ', c.first_name, c.last_name), '')) AS username,
        COALESCE(${label ?? null}, sr.label) AS label,
        COUNT(sr.analysis_id) AS total,
        AVG(sr.score_positive) AS avgPos,
        AVG(sr.score_neutral) AS avgNeu,
        AVG(sr.score_negative) AS avgNeg
      FROM messages m
      INNER JOIN customers c ON c.id = m.sender_customer_id -- customer relation
      INNER JOIN analyses a ON a.message_id = m.id
      INNER JOIN sentiment_results sr ON sr.analysis_id = a.id
      WHERE 
        sr.label = COALESCE(${storedLabel}, sr.label) AND
        m.direction = 'inbound' AND
        m.sender_customer_id IS NOT NULL
      GROUP BY c.id, sr.label
      ORDER BY total DESC
      LIMIT ${limit}
    `;
  }
}
