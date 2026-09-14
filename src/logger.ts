import type { AppConfig } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

let currentLevel: Level = 'info';

export function setLogLevel(level: Level): void {
  currentLevel = level;
}

export function initLogger(cfg: AppConfig): void {
  setLogLevel(cfg.logLevel);
}

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function fmt(level: Level, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  const base = `${ts} [${level.toUpperCase()}] ${msg}`;
  if (extra === undefined) return base;
  try {
    return `${base} ${JSON.stringify(extra)}`;
  } catch {
    return `${base} [unserializable]`;
  }
}

export const log = {
  debug(msg: string, extra?: unknown): void {
    if (shouldLog('debug')) console.debug(fmt('debug', msg, extra));
  },
  info(msg: string, extra?: unknown): void {
    if (shouldLog('info')) console.info(fmt('info', msg, extra));
  },
  warn(msg: string, extra?: unknown): void {
    if (shouldLog('warn')) console.warn(fmt('warn', msg, extra));
  },
  error(msg: string, extra?: unknown): void {
    if (shouldLog('error')) console.error(fmt('error', msg, extra));
  },
};
