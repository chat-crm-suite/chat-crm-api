import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';

import type { SentimentLabel } from '../../../contracts/index';
import { Analysis } from './analysis.entity';

/** Previously sentiment_analysis: 1:1 detail of `analyses`. */
@Entity('sentiment_results')
export class SentimentResult {
  @PrimaryColumn({ name: 'analysis_id', type: 'varchar', length: 36 })
  analysisId: string;

  @OneToOne(() => Analysis, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'analysis_id' })
  analysis: Analysis;

  @Column({ type: 'varchar', length: 50 })
  label: SentimentLabel;

  @Column({ name: 'score_positive', type: 'decimal', precision: 5, scale: 4, default: 0 })
  scorePositive: number;

  @Column({ name: 'score_neutral', type: 'decimal', precision: 5, scale: 4, default: 0 })
  scoreNeutral: number;

  @Column({ name: 'score_negative', type: 'decimal', precision: 5, scale: 4, default: 0 })
  scoreNegative: number;
}
