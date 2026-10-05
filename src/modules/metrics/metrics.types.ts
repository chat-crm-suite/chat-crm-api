/**
 * Tables the metrics module can aggregate against (schema v2 names).
 * `chats` -> `conversations`, `contacts` -> `customers` and
 * `transfers` -> `conversation_assignments` (reason = 'transfer').
 */
export type Table =
  | 'conversations'
  | 'messages'
  | 'users'
  | 'company_members'
  | 'customers'
  | 'conversation_assignments';

export type Metric = 'chats' | 'messages' | 'agents' | 'clients';
export type CompareMetric = 'chat' | 'message' | 'agent' | 'transfer' | 'client';

export type TopType = 'agents' | 'clients';

export type SentimentType = 'POS' | 'NEU' | 'NEG';
export type SentimentActor = 'agent' | 'client';
