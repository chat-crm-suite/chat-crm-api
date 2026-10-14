#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Live conversation against the real WhatsApp Cloud API (dev app).
 *
 * On-demand and non-interactive: login -> socket -> for every kind, stage the
 * file (`POST /conversations/:id/uploads`) and send it (`conversation:message
 * :send` with ack) -> wait for the real ticks Meta returns -> verify the REST
 * thread. Never part of `pnpm test` (no `.spec` suffix).
 *
 * Usage:
 *   pnpm live:chat --username admin --password **** --to 15551234567
 *
 * Options:
 *   --username <user>   chat-crm username (required)
 *   --password <pass>   chat-crm password (or CHATCRM_PASSWORD env)
 *   --to <phone>        customer phone of the conversation to reuse (required)
 *   --api <url>         API base (default: API_BASE env or http://localhost:3000)
 *   --company <id>      company to act in (default: the first membership)
 *   --only <kinds>      comma list of kinds to send (default: all)
 *   --help              show the usage text
 *
 * Kinds: text, image, document, video, voice, sticker. Image and document are
 * generated on the fly; video, voice note (a real Chrome/Edge webm/opus
 * recording, remuxed to ogg by the API) and sticker come from
 * `scripts/fixtures/`.
 *
 * Prerequisite: the test number must have received a message from a real
 * phone in the last 24h (WhatsApp free-text window), otherwise Meta rejects
 * the send with code 131047.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { io } from 'socket.io-client';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ALL_KINDS = ['text', 'image', 'document', 'video', 'voice', 'sticker'];

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
  --company <id>      company to act in (default: the first membership)
  --only <kinds>      comma list of kinds to send (default: all)
  --help              show this help

Prerequisite: the test number must have received a message from a real phone
in the last 24h (WhatsApp free-text window), otherwise Meta rejects the send
with code 131047.

Kinds: ${ALL_KINDS.join(', ')}. Media is staged with POST /conversations/:id/uploads
and sent by uploadId (video/voice/sticker files live in scripts/fixtures/).`);
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
const companyArg = readArg('company');
const kinds = (readArg('only') ?? ALL_KINDS.join(','))
  .split(',')
  .map((kind) => kind.trim())
  .filter(Boolean);
const unknownKinds = kinds.filter((kind) => !ALL_KINDS.includes(kind));
if (unknownKinds.length) {
  console.error(`Unknown kind(s): ${unknownKinds.join(', ')}`);
  process.exit(1);
}

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

// ---------------------------------------------------------------------------
// Fixtures: small real files, so every kind exercises the real pipeline.
// ---------------------------------------------------------------------------

/** A solid 320x200 PNG, built with zlib (no image library). */
function makePng() {
  const width = 320;
  const height = 200;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([0x25, 0xd3, 0x66], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a line of text and a valid xref table. */
function makePdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  objects[3] = [
    `<< /Length ${stream.length} >>`,
    'stream',
    stream,
    'endstream',
  ].join('\n');

  // Every object's byte offset goes into the xref table.
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const fixture = (name) => readFileSync(join(FIXTURES, name));

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

let token = null;
let companyId = null;
let userId = null;

/** Stages a file for the conversation: multipart `file` + `kind`. */
async function upload(conversationId, file) {
  const form = new FormData();
  form.append('kind', file.kind);
  form.append('file', new Blob([file.data], { type: file.mimeType }), file.name);
  const res = await fetch(`${API}/conversations/${conversationId}/uploads`, {
    method: 'POST',
    headers: {
      Cookie: `access_token=${token}`,
      'x-company-id': companyId ?? '',
    },
    body: form,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

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
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
  userId = claims.sub;

  // The token lists the user's active memberships; the API honors the one
  // sent as `x-company-id` on every request.
  const memberships = Array.isArray(claims.memberships) ? claims.memberships : [];
  const membership = companyArg
    ? memberships.find((entry) => entry.cid === companyArg)
    : memberships[0];
  if (!membership) {
    bad(
      companyArg
        ? `The user is not an active member of company ${companyArg}.`
        : 'The user has no active company membership.',
    );
    if (memberships.length > 1) {
      note(`Memberships: ${memberships.map((entry) => entry.cid).join(', ')}`);
    }
    throw new RunError('①');
  }
  companyId = membership.cid;
  if (!companyArg && memberships.length > 1) {
    warn(`Several companies: using ${companyId} (pick one with --company <id>).`);
  }

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

  socket.emit('conversation:join', { room: conversation.id, companyId });
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

async function sendPhase(item, seenBroadcastIds, context) {
  phase(item.label[0], item.label[1]);

  const clientMessageId = `${runId}-${item.kind}`;
  let msg = item.msg;

  if (item.file) {
    const staged = await upload(context.conversation.id, item.file);
    if (!staged.ok) {
      bad(
        `Upload refused (status ${staged.status}): ${JSON.stringify(staged.json?.message ?? staged.json)}`,
      );
      throw new RunError(item.label[0]);
    }
    const facts = [
      staged.json.mimeType,
      formatBytes(staged.json.sizeBytes),
      staged.json.durationMs ? seconds(staged.json.durationMs) : null,
      staged.json.width ? `${staged.json.width}x${staged.json.height}` : null,
    ].filter(Boolean);
    ok(`Staged ${staged.json.filename} (${facts.join(' · ')})`);
    msg = item.msg(staged.json.uploadId);
  }

  const emittedAt = Date.now();
  const ack = await socket
    .timeout(10000)
    .emitWithAck('conversation:message:send', {
      room: context.conversation.id,
      companyId,
      clientMessageId,
      msg,
    })
    .catch((error) => ({ ok: false, code: 'timeout', message: error.message }));
  if (!ack?.ok) {
    bad(`Send refused by the API: ${ack?.code} · ${ack?.message}`);
    throw new RunError(item.label[0]);
  }
  ok('Send acknowledged (queued)');

  const broadcast = await waitFor(
    () =>
      transcript.events.find(
        (entry) =>
          entry.event === 'broadcast' &&
          entry.payload?.clientMessageId === clientMessageId &&
          !seenBroadcastIds.has(entry.payload?.id),
      ),
    15000,
  );
  if (!broadcast) {
    bad('No broadcast arrived within 15s (message was not persisted/emitted).');
    throw new RunError(item.label[0]);
  }
  seenBroadcastIds.add(broadcast.payload.id);
  ok(`Message created as pending and broadcast to the thread (${broadcast.payload.msg.type})`);

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
  };
}

async function repliesPhase(records) {
  phase('⑨', 'WhatsApp replies');

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
        `${record.item.kind}: Meta accepted it but neither the delivered nor the read receipt arrived within 30s.`,
      );
      throw new RunError('⑨');
    }

    record.deliveredAt = Date.now();
    const sentTime = seconds(record.sentAt - record.emittedAt);
    const receiptTime = seconds(record.deliveredAt - record.sentAt);
    ok(
      receipt.kind === 'delivered'
        ? `${record.item.kind.padEnd(8)} accepted by Meta → reached the phone (sent ${sentTime} · delivered ${receiptTime})`
        : `${record.item.kind.padEnd(8)} accepted by Meta → read by the phone (sent ${sentTime} · read ${receiptTime}; delivered implied)`,
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

function renderThreadLine(message, conversation) {
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
  const view = message.msg ?? { type: 'unsupported' };
  const status =
    senderType === 'member' ? ` ${dim(statusGlyph(message.status))}` : '';

  let body;
  if (view.type === 'text') body = view.text;
  else if (view.type === 'document') body = `[document] ${view.filename ?? ''} ${view.caption ?? ''}`;
  else if (view.type === 'audio') body = `[${view.voice ? 'voice note' : 'audio'}]`;
  else if (view.type === 'unsupported') body = `[${view.originalType}] ${view.text ?? ''}`;
  else body = `[${view.type}] ${view.caption ?? ''}`;

  out(`  ${who.padEnd(7)} ${dim(at)}  ${body.trim()}${status}`);

  if (view.media?.url) {
    const facts = [
      view.media.mimeType,
      view.media.sizeBytes ? formatBytes(view.media.sizeBytes) : null,
      view.media.durationMs ? seconds(view.media.durationMs) : null,
    ].filter(Boolean);
    out(`           ${dim(`→ ${view.media.url} (${facts.join(' · ')})`)}`);
  }
}

async function threadPhase(records, context) {
  phase('⑩', 'Final thread (what the customer sees)');

  const thread = await api('GET', `/conversations/${context.conversation.id}/messages`);
  if (!thread.ok || !Array.isArray(thread.json)) {
    bad(`GET /conversations/:id/messages failed (status ${thread.status}).`);
    throw new RunError('⑩');
  }
  transcript.thread = thread.json;

  const ordered = [...thread.json].reverse();
  const missing = records.filter(
    (record) => !ordered.some((message) => message.id === record.id),
  );
  if (missing.length > 0) {
    bad(`${missing.length} sent message(s) missing from the REST thread.`);
    throw new RunError('⑩');
  }

  for (const message of ordered.slice(-(records.length + 2))) {
    renderThreadLine(message, context.conversation);
  }

  ok(`REST thread matches the live events (${ordered.length} messages)`);
  out('');
  out(`  Kinds sent: ${records.map((record) => record.item.kind).join(', ')}`);
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

  const tag = `live-check ${runId}`;
  const catalog = [
    {
      kind: 'text',
      label: ['③', 'Agent send (text)'],
      msg: { type: 'text', text: `${tag}: hello from the script` },
    },
    {
      kind: 'image',
      label: ['④', 'Agent send (image)'],
      file: { kind: 'image', data: makePng(), mimeType: 'image/png', name: 'live-check.png' },
      msg: (uploadId) => ({ type: 'image', uploadId, caption: `${tag} image` }),
    },
    {
      kind: 'document',
      label: ['⑤', 'Agent send (document)'],
      file: {
        kind: 'document',
        data: makePdf(`${tag} document`),
        mimeType: 'application/pdf',
        name: 'live-check.pdf',
      },
      msg: (uploadId) => ({
        type: 'document',
        uploadId,
        filename: 'live-check.pdf',
        caption: `${tag} document`,
      }),
    },
    {
      kind: 'video',
      label: ['⑥', 'Agent send (video)'],
      file: { kind: 'video', data: fixture('video.mp4'), mimeType: 'video/mp4', name: 'live-check.mp4' },
      msg: (uploadId) => ({ type: 'video', uploadId, caption: `${tag} video` }),
    },
    {
      kind: 'voice',
      label: ['⑦', 'Agent send (voice note, webm → ogg)'],
      file: {
        kind: 'audio',
        data: fixture('voice-note.webm'),
        mimeType: 'audio/webm;codecs=opus',
        name: 'voice-note.webm',
      },
      msg: (uploadId) => ({ type: 'audio', uploadId, voice: true }),
    },
    {
      kind: 'sticker',
      label: ['⑧', 'Agent send (sticker)'],
      file: { kind: 'sticker', data: fixture('sticker.webp'), mimeType: 'image/webp', name: 'sticker.webp' },
      msg: (uploadId) => ({ type: 'sticker', source: { uploadId } }),
    },
  ];
  const items = catalog.filter((item) => kinds.includes(item.kind));

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
