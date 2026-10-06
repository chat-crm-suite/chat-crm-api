#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Live conversation against the real WhatsApp Cloud API (dev app).
 *
 * On-demand and non-interactive: login -> socket -> send text/image/document
 * -> wait for the real ticks Meta returns -> verify the REST thread.
 * Never part of `pnpm test` (no `.spec` suffix).
 *
 * Usage:
 *   pnpm live:chat --username admin --password **** --to 15551234567
 *
 * Options:
 *   --username <user>   chat-crm username (required)
 *   --password <pass>   chat-crm password (or CHATCRM_PASSWORD env)
 *   --to <phone>        customer phone of the conversation to reuse (required)
 *   --api <url>         API base (default: API_BASE env or http://localhost:3000)
 *   --image-url <url>   image to send (default: a small public png)
 *   --doc-url <url>     document to send (default: a small public pdf)
 *   --help              show the usage text
 *
 * Prerequisite: the test number must have received a message from a real
 * phone in the last 24h (WhatsApp free-text window), otherwise Meta rejects
 * the send with code 131047.
 *
 * TODO pending message types: audio, video, sticker, location, contact,
 * template, interactive, reaction.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const DEFAULT_IMAGE_URL =
  'https://raw.githubusercontent.com/github/explore/main/topics/nodejs/nodejs.png';
const DEFAULT_DOC_URL =
  'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

// ---------------------------------------------------------------------------
// CLI + env
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const readArg = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const hasFlag = (name) => argv.includes(`--${name}`);

function usage() {
  console.log(`Live conversation against the real WhatsApp Cloud API (dev app).

Usage:
  pnpm live:chat --username <user> --password <pass> --to <phone> [options]

Options:
  --username <user>   chat-crm username (required)
  --password <pass>   chat-crm password (or CHATCRM_PASSWORD env)
  --to <phone>        customer phone of the conversation to reuse (required)
  --api <url>         API base (default: API_BASE env or http://localhost:3000)
  --image-url <url>   image to send (default: ${DEFAULT_IMAGE_URL})
  --doc-url <url>     document to send (default: ${DEFAULT_DOC_URL})
  --help              show this help

Prerequisite: the test number must have received a message from a real phone
in the last 24h (WhatsApp free-text window), otherwise Meta rejects the send
with code 131047.

Types covered: text, image, document. Pending (TODO in script): audio, video,
sticker, location, contact, template, interactive, reaction.`);
}

if (hasFlag('help')) {
  usage();
  process.exit(0);
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const username = readArg('username');
const password = readArg('password') ?? process.env.CHATCRM_PASSWORD;
const to = readArg('to');
const API = (
  readArg('api') ??
  process.env.API_BASE ??
  'http://localhost:3000'
).replace(/\/+$/, '');
const imageUrl = readArg('image-url') ?? DEFAULT_IMAGE_URL;
const docUrl = readArg('doc-url') ?? DEFAULT_DOC_URL;

if (!username || !password || !to) {
  console.error(
    'Missing required arguments: --username, --password (or CHATCRM_PASSWORD), --to',
  );
  console.log('');
  usage();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (value) =>
  useColor ? `\u001b[${code}m${value}\u001b[0m` : String(value);
const green = paint('32');
const red = paint('31');
const yellow = paint('33');
const dim = paint('2');
const bold = paint('1');

const out = (line = '') => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

const startedAtMs = Date.now();
const startedAt = new Date();
const pad = (value) => String(value).padStart(2, '0');
const stamp = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(
  startedAt.getDate(),
)}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(
  startedAt.getSeconds(),
)}`;
const runId = stamp;
const transcriptPath = join('.temp', `live-${stamp}.json`);

const transcript = {
  run: runId,
  api: API,
  to,
  startedAt: startedAt.toISOString(),
  steps: [],
  events: [],
  thread: null,
  result: null,
};
let currentPhase = null;
let notices = 0;
let socket = null;

function phase(label, title) {
  currentPhase = label;
  out('');
  out(bold(`${label} ${title}`));
}

function step(status, detail) {
  transcript.steps.push({ phase: currentPhase, status, detail });
}
function ok(detail) {
  out(`  ${green('✓')} ${detail}`);
  step('ok', detail);
}
function bad(detail) {
  out(`  ${red('✗')} ${detail}`);
  step('fail', detail);
}
function warn(detail) {
  notices += 1;
  out(`  ${yellow('⚠')} ${detail}`);
  step('warn', detail);
}
function note(detail) {
  out(`    ${dim(detail)}`);
  step('note', detail);
}
function asset(detail) {
  out(`  ${dim('→')} asset: ${detail}`);
  step('asset', detail);
}

class RunError extends Error {
  constructor(phaseLabel, message) {
    super(message);
    this.phaseLabel = phaseLabel;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const capitalize = (value) =>
  String(value ?? '').charAt(0).toUpperCase() + String(value ?? '').slice(1);

function maskPhone(value) {
  const raw = String(value ?? '');
  if (raw.length <= 7) return raw;
  return `${raw.slice(0, 4)}•••${raw.slice(-4)}`;
}

function formatBytes(bytes) {
  if (!bytes) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function headMeta(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    const subtype = contentType.split(';')[0].split('/')[1] || 'unknown';
    const length = Number(res.headers.get('content-length') ?? 0);
    return { type: subtype, size: formatBytes(length) };
  } catch {
    return null;
  }
}

function basename(value) {
  try {
    return new URL(value).pathname.split('/').filter(Boolean).pop() ?? 'file';
  } catch {
    return 'file';
  }
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

let token = null;
let companyId = null;
let userId = null;

async function api(method, path, body) {
  const headers = {
    Cookie: `access_token=${token}`,
    'x-company-id': companyId ?? '',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json };
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

function banner() {
  out('');
  out(bold('═'.repeat(52)));
  out(
    ` ${bold('LIVE CONVERSATION')} · ${startedAt.toDateString()} ${pad(
      startedAt.getHours(),
    )}:${pad(startedAt.getMinutes())} · run ${runId}`,
  );
  out(` API ${API}  →  test number ${maskPhone(to)}`);
  out(bold('═'.repeat(52)));
  out(
    dim(
      'Prerequisite: the test number must have received a message from a real',
    ),
  );
  out(
    dim('phone in the last 24h (WhatsApp free-text window). Otherwise Meta'),
  );
  out(dim('rejects the send with code 131047.'));
}

async function accessPhase() {
  phase('①', 'Access');

  let loginRes;
  try {
    loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    bad(`API unreachable at ${API}: ${error.message}`);
    note('Start the dev stack first (docker compose up) and retry.');
    throw new RunError('①');
  }

  if (!loginRes.ok) {
    bad(`Login rejected (${loginRes.status}): check --username / --password.`);
    note('Nothing else ran, no data was touched.');
    throw new RunError('①');
  }

  const cookie = loginRes.headers
    .getSetCookie()
    .find((value) => value.startsWith('access_token='));
  if (!cookie) {
    bad('Login succeeded but no access_token cookie came back.');
    throw new RunError('①');
  }
  token = decodeURIComponent(
    cookie.split(';')[0].slice('access_token='.length),
  );
  userId = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ).sub;

  const companies = await api('GET', '/auth/me/companies');
  if (
    !companies.ok ||
    !Array.isArray(companies.json) ||
    companies.json.length === 0
  ) {
    bad(`Could not resolve the company (status ${companies.status}).`);
    throw new RunError('①');
  }
  companyId = companies.json[0];

  let companyName = companyId.slice(0, 8);
  try {
    const company = await api('GET', '/company/me');
    companyName = company.json?.name ?? company.json?.company?.name ?? companyName;
  } catch {
    /* best effort */
  }

  ok(`Logged in as ${username} (company "${companyName}")`);
}

async function connectionPhase() {
  phase('②', 'Live connection');

  const list = await api('GET', '/conversations/list');
  if (!list.ok || !Array.isArray(list.json)) {
    bad(`GET /conversations/list failed (status ${list.status}).`);
    throw new RunError('②');
  }
  const conversation = list.json.find(
    (item) => digits(item.customer?.phone) === digits(to),
  );
  if (!conversation) {
    bad(`No conversation found for ${maskPhone(to)}.`);
    note('The live run reuses an existing chat on purpose: send an inbound');
    note('message first (Postman signed webhook or a real phone), then retry.');
    throw new RunError('②');
  }
  const customerPhone = conversation.customer?.phone ?? to;
  ok(
    `Found the chat with ${conversation.customer?.displayName ?? 'customer'} (${maskPhone(
      customerPhone,
    )}) — ${conversation.id.slice(0, 8)}…`,
  );

  socket = io(`${API}/conversation`, {
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: 10000,
    extraHeaders: {
      Cookie: `access_token=${token}`,
      'x-company-id': companyId,
    },
    auth: { companyId },
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket connect timed out (10s)')),
        10000,
      );
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } catch (error) {
    bad(`Socket connection failed: ${error.message}`);
    throw new RunError('②');
  }

  const events = transcript.events;
  const push = (event, payload) =>
    events.push({ at: new Date().toISOString(), event, payload });
  socket.on('conversation:joined', (payload) =>
    push('conversation:joined', payload),
  );
  socket.on('conversation:message:broadcast', (payload) =>
    push('broadcast', payload),
  );
  socket.on('conversation:message:status', (payload) => push('status', payload));
  socket.on('conversation:message:error', (payload) => push('error', payload));

  socket.emit('conversation:join', { room: conversation.id });
  const joined = await waitFor(
    () =>
      events.find(
        (entry) =>
          entry.event === 'conversation:joined' &&
          entry.payload?.room === conversation.id,
      ),
    5000,
  );
  if (!joined) {
    bad('Join confirmation (conversation:joined) did not arrive.');
    note('Check the access_token cookie and the x-company-id handshake header.');
    throw new RunError('②');
  }
  ok(`Socket connected and joined the chat ${conversation.id.slice(0, 8)}…`);

  return { conversation, customerPhone };
}

function matchesItem(payload, item) {
  if (payload?.sender?.type !== 'member') return false;
  if (payload?.msg?.type !== item.type) return false;
  if (item.type === 'text') return payload.msg.content?.body === item.content.body;
  return payload.msg?.mediaUrl === item.content.link;
}

async function sendPhase(item, seenBroadcastIds, context) {
  phase(item.label[0], item.label[1]);

  const meta = item.asset ? await headMeta(item.asset) : null;
  const metaText = meta ? `${meta.type} · ${meta.size}` : 'type unknown · size unknown';

  const clientMessageId = `${runId}-${item.type}`;
  const emittedAt = Date.now();
  socket.emit('conversation:message:send', {
    room: context.conversation.id,
    clientMessageId,
    to: context.customerPhone,
    sender: { id: userId, type: 'member' },
    msg: { type: item.type, content: item.content },
  });

  const broadcast = await waitFor(
    () =>
      transcript.events.find(
        (entry) =>
          entry.event === 'broadcast' &&
          !seenBroadcastIds.has(entry.payload?.id) &&
          matchesItem(entry.payload, item),
      ),
    15000,
  );
  if (!broadcast) {
    bad('No broadcast arrived within 15s (message was not persisted/emitted).');
    throw new RunError(item.label[0]);
  }
  seenBroadcastIds.add(broadcast.payload.id);
  ok('Message created as pending and broadcast to the thread');

  if (item.type === 'image') {
    asset(`${item.asset} (${metaText}) · caption: "${item.content.caption}"`);
  } else if (item.type === 'document') {
    asset(`${item.content.filename} (${metaText})`);
    note(item.asset);
  }

  // Duplicate grace window: the two fanout targets (chat room + assignee room)
  // deliver the same event back-to-back when this socket is in both.
  await sleep(2500);
  const deliveries = transcript.events.filter(
    (entry) =>
      entry.event === 'broadcast' && entry.payload?.id === broadcast.payload.id,
  ).length;
  if (deliveries > 1) {
    bad(`Delivered ${deliveries} times to the thread (same id, ${deliveries} deliveries).`);
    note('Cause: fanout emits to the chat room and the assignee room, and this');
    note('socket is in both (known bug, fix pending). Single row in the DB:');
    note('delivery-only duplication.');
    throw new RunError(item.label[0]);
  }
  ok('Delivered exactly once (no duplicates)');

  const settled = await waitFor(() => {
    const failed = transcript.events.find(
      (entry) =>
        entry.event === 'status' &&
        entry.payload?.id === broadcast.payload.id &&
        entry.payload.status === 'failed',
    );
    if (failed) return { kind: 'failed', patch: failed.payload };
    const sent = transcript.events.find(
      (entry) =>
        entry.event === 'status' &&
        entry.payload?.id === broadcast.payload.id &&
        entry.payload.status === 'sent',
    );
    return sent ? { kind: 'sent', patch: sent.payload } : null;
  }, 25000);

  if (!settled) {
    bad('Meta did not answer within 25s (no sent/failed patch).');
    throw new RunError(item.label[0]);
  }
  if (settled.kind === 'failed') {
    const code = settled.patch.errorCode ?? 'unknown';
    bad(
      `Meta rejected the send: ${settled.patch.errorMessage ?? 'no detail'} (code ${code}).`,
    );
    if (String(code) === '131047') {
      note('Next step: message the test number from your phone (opens 24h) and');
      note('rerun, or use an approved template.');
    } else {
      note('The message is stored as failed with the reason, and the error');
      note('reached the thread live.');
    }
    throw new RunError(item.label[0]);
  }

  return {
    item,
    id: broadcast.payload.id,
    clientMessageId,
    emittedAt,
    sentAt: Date.now(),
    metaByUrl: item.asset ? { [item.asset]: metaText } : null,
  };
}

async function repliesPhase(records) {
  phase('⑥', 'WhatsApp replies');

  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    // Meta can send `read` before `delivered` (or skip the delivered webhook
    // when the chat is opened quickly); the API then ignores a late delivered
    // as a regression by design, so either receipt proves the phone got it.
    const receipt = await waitFor(() => {
      const delivered = transcript.events.find(
        (entry) =>
          entry.event === 'status' &&
          entry.payload?.id === record.id &&
          entry.payload.status === 'delivered',
      );
      if (delivered) return { kind: 'delivered', entry: delivered };
      const read = transcript.events.find(
        (entry) =>
          entry.event === 'status' &&
          entry.payload?.id === record.id &&
          entry.payload.status === 'read',
      );
      return read ? { kind: 'read', entry: read } : null;
    }, 30000);

    if (!receipt) {
      bad(
        `${record.item.type}: Meta accepted it but neither the delivered nor the read receipt arrived within 30s.`,
      );
      throw new RunError('⑥');
    }

    record.deliveredAt = Date.now();
    const sentTime = seconds(record.sentAt - record.emittedAt);
    const receiptTime = seconds(record.deliveredAt - record.sentAt);
    ok(
      receipt.kind === 'delivered'
        ? `${record.item.type.padEnd(8)} accepted by Meta → reached the phone (sent ${sentTime} · delivered ${receiptTime})`
        : `${record.item.type.padEnd(8)} accepted by Meta → read by the phone (sent ${sentTime} · read ${receiptTime}; delivered implied)`,
    );
  }

  const read = await waitFor(
    () =>
      transcript.events.find(
        (entry) =>
          entry.event === 'status' &&
          ids.has(entry.payload?.id) &&
          entry.payload.status === 'read',
      ),
    30000,
  );
  if (read) ok('Read receipt arrived (read)');
  else
    warn(
      'Read (read) not confirmed within 30s → open the chat on the phone to see it; not counted as failure.',
    );
}

function statusGlyph(status) {
  if (status === 'pending') return '…';
  if (status === 'sent') return '✓';
  if (status === 'delivered') return '✓✓';
  if (status === 'read') return '✓✓ read';
  if (status === 'failed') return '✗';
  return '';
}

function renderThreadLine(message, conversation, metaByUrl) {
  const senderType = message.sender?.type ?? 'system';
  const who =
    senderType === 'customer'
      ? conversation.customer?.displayName ??
        conversation.customer?.phone ??
        'Customer'
      : senderType === 'member'
        ? 'Agent'
        : capitalize(senderType);
  const at = new Date(message.timestamp).toTimeString().slice(0, 5);
  const type = message.msg?.type ?? 'text';
  const content = message.msg?.content ?? {};
  const status =
    senderType === 'member' ? ` ${dim(statusGlyph(message.status))}` : '';

  let body;
  if (type === 'text') body = content.body ?? '';
  else if (type === 'image') body = `[image] ${content.caption ?? ''}`.trim();
  else if (type === 'document') {
    body = `[document] ${content.filename ?? basename(message.msg?.mediaUrl ?? '')}`;
  } else body = `[${type}]`;

  out(`  ${who.padEnd(7)} ${dim(at)}  ${body}${status}`);

  if ((type === 'image' || type === 'document') && message.msg?.mediaUrl) {
    const meta = metaByUrl.get(message.msg.mediaUrl);
    out(`           ${dim(`→ ${message.msg.mediaUrl}${meta ? ` (${meta})` : ''}`)}`);
  }
}

async function threadPhase(records, context) {
  phase('⑦', 'Final thread (what the customer sees)');

  const thread = await api('GET', `/conversations/${context.conversation.id}/messages`);
  if (!thread.ok || !Array.isArray(thread.json)) {
    bad(`GET /conversations/:id/messages failed (status ${thread.status}).`);
    throw new RunError('⑦');
  }
  transcript.thread = thread.json;

  const ordered = [...thread.json].reverse();
  const missing = records.filter(
    (record) => !ordered.some((message) => message.id === record.id),
  );
  if (missing.length > 0) {
    bad(`${missing.length} sent message(s) missing from the REST thread.`);
    throw new RunError('⑦');
  }

  const metaByUrl = new Map();
  for (const record of records) {
    if (record.metaByUrl) {
      for (const [url, meta] of Object.entries(record.metaByUrl)) {
        metaByUrl.set(url, meta);
      }
    }
  }

  for (const message of ordered.slice(-8)) {
    renderThreadLine(message, context.conversation, metaByUrl);
  }

  ok(`REST thread matches the live events (${ordered.length} messages)`);
  out('');
  out('  Types covered: text, image, document ·');
  out(
    '  pending (TODO in script): audio, video, sticker, location, contact, template, interactive, reaction',
  );
}

function printResult(success, error) {
  out('');
  out('─'.repeat(52));
  const total = seconds(Date.now() - startedAtMs);
  if (success) {
    const noticeText =
      notices === 0 ? '' : ` (${notices} notice${notices > 1 ? 's' : ''})`;
    out(` ${green(`RESULT: ALL GOOD${noticeText}`)} · ${total}`);
  } else {
    const at = error?.phaseLabel ? ` at ${error.phaseLabel}` : '';
    out(` ${red(`RESULT: FAILED${at}`)} · ${total}`);
  }
  out(dim(` Technical detail: ${transcriptPath}`));
}

function writeTranscript() {
  mkdirSync('.temp', { recursive: true });
  writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
}

async function run() {
  banner();
  await accessPhase();
  const context = await connectionPhase();

  const items = [
    {
      label: ['③', 'Agent send (text)'],
      type: 'text',
      content: { body: `live-check ${runId}: hello from the script` },
    },
    {
      label: ['④', 'Agent send (image)'],
      type: 'image',
      content: { link: imageUrl, caption: `live-check ${runId} image` },
      asset: imageUrl,
    },
    {
      label: ['⑤', 'Agent send (document)'],
      type: 'document',
      content: {
        link: docUrl,
        filename: basename(docUrl),
        caption: `live-check ${runId} document`,
      },
      asset: docUrl,
    },
  ];

  const seenBroadcastIds = new Set();
  const records = [];
  for (const item of items) {
    records.push(await sendPhase(item, seenBroadcastIds, context));
  }

  await repliesPhase(records);
  await threadPhase(records, context);
}

try {
  await run();
  transcript.result = 'pass';
  printResult(true, null);
  socket?.close();
  writeTranscript();
  process.exit(0);
} catch (error) {
  transcript.result = 'fail';
  transcript.error = {
    phase: error?.phaseLabel ?? null,
    message: error?.message,
    stack: error?.stack,
  };
  if (!(error instanceof RunError)) {
    bad(`Unexpected error: ${error?.message ?? String(error)}`);
  }
  printResult(false, error);
  socket?.close();
  writeTranscript();
  process.exit(1);
}
