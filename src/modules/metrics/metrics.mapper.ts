// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { CompareBuilder } from "./builders/compare.builder";
import { ScoreBuilder } from "./builders/score.builder";
import { AgentQuery, ClientQuery, SentimentTopQuery, SentimentTop } from "./metrics.interface";
import { SentimentActor } from "./metrics.types";

export class MetricMapper {

  static toAgentMetrics(queries: AgentQuery[]) {
    return queries.map((r) => ({
      id: r.id,
      agentName: `${r.firstName} ${r.lastName}`.trim(),
      avg: {
        pos: Number(r.avgPos) || 0,
        neu: Number(r.avgNeu) || 0,
        neg: Number(r.avgNeg) || 0
      },
      total: Number(r.total) || 0
    }));
  }

  static toBestClients(queries: ClientQuery[]) {
    return queries.map((q) => ({
      clientId: q.contactId,
      clientName: q.username || 'Sin nombre',
      totalMessages: Number(q.totalMessages),
      avgSentiment: Number(q.avgPos) || 0,
      score: Number(q.score) || 0
    }));
  }

  static sentimentTop(tops: SentimentTopQuery[], actor?: SentimentActor): SentimentTop[] {
    return tops.map(element => {
      return new ScoreBuilder<SentimentTop>(element)
        .owner('owner', ['id', 'username'], actor)
        .metrics('sentiment', { pos: 'avgPos', neu: 'avgNeu', neg: 'avgNeg' })
        .label()
        .stat('total')
        .build()
    });
  }

  static compare(label: string, values: [number, number]) {
    return new CompareBuilder()
      .label(label)
      .compare(values[0], values[1], ['previus', 'current'])
      .percent()
      .build();
  }
}