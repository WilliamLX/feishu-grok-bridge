/**
 * Library entry — re-exports for programmatic use.
 */
export { loadConfig, missingRequired, redactSecrets } from './config.js';
export type { AppConfig } from './config.js';
export { BridgeCore } from './core/bridge.js';
export { checkAcl } from './core/acl.js';
export { parseCommand, helpText } from './core/commands.js';
export { DedupeStore } from './core/dedupe.js';
export { MemorySessionStore } from './core/session.js';
export { createBackend, EchoBackend, HttpBackend, CursorAgentBackend } from './backend/index.js';
export type { GrokBackend, BackendRequest, BackendReply } from './backend/index.js';
export { startWsClient, normalizeReceiveV1 } from './feishu/ws.js';
export { createLarkClient, fetchTenantTokenHttp } from './feishu/auth.js';
