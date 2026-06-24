/**
 * adapters/index.ts — Host adapter registry.
 *
 * Register all host adapters. To add support for a new host:
 * 1. Create a new adapter file implementing AgentHostAdapter
 * 2. Add it to the hostAdapters array below
 * 3. No changes needed in setup/connect/disconnect main flow
 */
import type { AgentHostAdapter } from './interface.js';
import { openClawAdapter } from './openclaw.js';
import { codexAdapter } from './codex.js';
import { claudeCodeAdapter } from './claude-code.js';
import { genericMcpAdapter } from './generic.js';

export const hostAdapters: AgentHostAdapter[] = [
  openClawAdapter,
  codexAdapter,
  claudeCodeAdapter,
  genericMcpAdapter,
];
