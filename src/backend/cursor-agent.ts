import type { BackendRequest, BackendReply, GrokBackend } from './types.js';

/**
 * Stub for a future Cursor Agent / Cloud Agent backend.
 *
 * TODO:
 * - Authenticate against Cursor Agent API / local agent IPC
 * - Map Feishu chat sessions → agent conversation threads
 * - Stream agent tool/status events into Feishu interactive cards
 * - Handle long-running tasks with progress updates
 */
export class CursorAgentBackend implements GrokBackend {
  readonly name = 'cursor-agent';

  async handle(_req: BackendRequest): Promise<BackendReply> {
    return {
      reply:
        '🚧 CursorAgentBackend 尚未实现（stub）。\n请将 `GROK_BACKEND` 设为 `echo` 或 `http`。\n\nTODO: wire Cursor Agent API / IPC here.',
    };
  }
}
