// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Jerremi Aron Chancan Labajos <chancanjeremiaron@gmail.com>

import { Module } from "@nestjs/common";
import { WhatsappModule } from "./whatsapp/whatsapp.module";

export {
  WhatsappModule,
}

export const modules = [
  WhatsappModule
]

@Module({
  imports: modules,
  exports: modules
}) export class IntegrationsModules { }