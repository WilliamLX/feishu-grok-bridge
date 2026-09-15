import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BotCatalog,
  UnknownAgentError,
  loadBotCatalogFromPath,
} from '../src/core/bots.js';

describe('BotCatalog', () => {
  it('lists enabled bots only for getEnabled/requireEnabled', () => {
    const c = BotCatalog.fromEntries([
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: false },
      { id: '  c  ', name: 'C' },
    ]);
    expect(c.listEnabled().map((b) => b.id).sort()).toEqual(['a', 'c']);
    expect(c.getEnabled('b')).toBeUndefined();
    expect(c.getEnabled('a')?.name).toBe('A');
    expect(() => c.requireEnabled('missing')).toThrow(UnknownAgentError);
    expect(() => c.requireEnabled('b')).toThrow(UnknownAgentError);
  });

  it('never falls back to another bot', () => {
    const c = BotCatalog.fromEntries([{ id: 'only', name: 'Only' }]);
    expect(c.getEnabled('other')).toBeUndefined();
  });

  it('fromFile + missing path warning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fgb-cat-'));
    const path = join(dir, 'bots.json');
    writeFileSync(
      path,
      JSON.stringify({ bots: [{ id: 'x', name: 'X', enabled: true }] }),
    );
    const loaded = BotCatalog.fromFile(path);
    expect(loaded.getEnabled('x')?.name).toBe('X');

    const missing = loadBotCatalogFromPath(join(dir, 'nope.json'));
    expect(missing.warning).toMatch(/not found/);
    expect(missing.catalog.listEnabled()).toEqual([]);
  });
});
