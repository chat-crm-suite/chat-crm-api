// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

/**
 * Registry of contract modules, grouped by source file.
 *
 * The contracts barrel (`src/contracts/index.ts`) flattens every export, so it
 * loses the file each schema came from. Drift reporting wants that grouping
 * ("user", "auth", ...), hence this explicit map. It is used only by the
 * snapshot generator (build-time tooling), never by the app or the frontend.
 *
 * Keeping it explicit (instead of a dynamic directory scan) makes grouping
 * deterministic and works identically under ts-jest and the compiled `dist`.
 */
import * as analysis from '../contracts/analysis.contract';
import * as analytics from '../contracts/analytics.contract';
import * as auth from '../contracts/auth.contract';
import * as caseContract from '../contracts/case.contract';
import * as channel from '../contracts/channel.contract';
import * as company from '../contracts/company.contract';
import * as conversation from '../contracts/conversation.contract';
import * as customer from '../contracts/customer.contract';
import * as ia from '../contracts/ia.contract';
import * as member from '../contracts/member.contract';
import * as message from '../contracts/message.contract';
import * as notification from '../contracts/notification.contract';
import * as pagination from '../contracts/pagination.contract';
import * as presence from '../contracts/presence.contract';
import * as serviceSettings from '../contracts/service-settings.contract';
import * as setup from '../contracts/setup.contract';
import * as socket from '../contracts/socket.contract';
import * as spend from '../contracts/spend.contract';
import * as template from '../contracts/template.contract';
import * as user from '../contracts/user.contract';
import * as whatsappWebhook from '../contracts/whatsapp-webhook.contract';

export const CONTRACT_MODULES = {
  analysis,
  analytics,
  auth,
  case: caseContract,
  channel,
  company,
  conversation,
  customer,
  ia,
  member,
  message,
  notification,
  pagination,
  presence,
  'service-settings': serviceSettings,
  setup,
  socket,
  spend,
  template,
  user,
  'whatsapp-webhook': whatsappWebhook,
} as const;

/** Contract keys in a stable, alphabetical order. */
export const CONTRACT_NAMES = Object.keys(CONTRACT_MODULES).sort();
