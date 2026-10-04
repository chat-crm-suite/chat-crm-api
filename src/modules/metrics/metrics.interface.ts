/**
 * Raw SQL result shapes for the metrics module (schema v2).
 * Keys mirror the SQL aliases, which are kept stable for the API consumers.
 */
export interface TrendPeriodQuery {
  date: string;
  avg_pos: number;
  avg_neu: number;
  avg_neg: number;
}

export interface AgentQuery {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string;
  profile?: string | null;
  phone?: string | null;
  avgPos: number;
  avgNeu: number;
  avgNeg: number;
  total: number;
}

/** Minimal staff identity (`users` + `company_members`) for the rankings. */
export interface SentimentUser {
  id: string;
  username: string;
}

/** Minimal customer identity (`customers`) for the rankings. */
export interface SentimentContact {
  id: string;
  username: string | null;
}

export interface SentimentTopQuery extends SentimentUser {
  total: number;
  label: string;
  avgPos: number;
  avgNeu: number;
  avgNeg: number;
}

export interface SentimentTop {
  onwer: SentimentUser | SentimentContact;
  agent?: SentimentUser;
  contact?: SentimentContact;
  label: string;
  sentiment: {
    pos: number;
    neu: number;
    neg: number;
  };
  total: number;
}

export interface ContactQuery {
  id: string;
  username: string | null;
  firstNames: string | null;
  lastNames: string | null;
  phoneNumber: string | null;
  profile?: string | null;
  count: number;
}

export interface AgentMetric {
  agentId: string;
  agentName: string;
  total: number;
  avg: number;
  score: number;
}

export interface ClientMetric {
  clientId: string;
  clientName: string;
  totalMessages: number;
  avgSentiment: number;
  score: number;
}

export interface ClientQuery {
  contactId: string;
  username: string | null;
  totalMessages: number;
  avgPos: number;
  totalPositive: number;
  score: number;
}
