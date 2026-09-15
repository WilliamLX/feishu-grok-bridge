import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBindingStore, MemoryBindingStore } from '../src/core/binding.js';

describe('MemoryBindingStore', () => {
  it('CRUD + epoch bump on bind', () => {
    const s = new MemoryBindingStore();
    expect(s.get('oc_1')).toBeUndefined();
    expect(s.epoch('oc_1')).toBe(0);
    s.bind('oc_1', 'echo-1');
    expect(s.get('oc_1')?.agentId).toBe('echo-1');
    expect(s.epoch('oc_1')).toBe(1);
    s.bind('oc_1', 'echo-2');
    expect(s.get('oc_1')?.agentId).toBe('echo-2');
    expect(s.epoch('oc_1')).toBe(2);
  });

  it('bumpEpoch without changing agentId', () => {
    const s = new MemoryBindingStore();
    s.bind('oc_1', 'echo-1');
    const e = s.bumpEpoch('oc_1');
    expect(e).toBe(2);
    expect(s.get('oc_1')?.agentId).toBe('echo-1');
  });
});

describe('FileBindingStore', () => {
  it('persists and reloads chat→agent bindings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fgb-bind-'));
    const path = join(dir, 'bindings.json');
    const a = new FileBindingStore(path);
    a.bind('oc_a', 'grok-main');
    a.bind('oc_b', 'grok-code');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      bindings: Record<string, { agentId: string }>;
    };
    expect(raw.bindings.oc_a.agentId).toBe('grok-main');

    const b = new FileBindingStore(path);
    expect(b.get('oc_a')?.agentId).toBe('grok-main');
    expect(b.get('oc_b')?.agentId).toBe('grok-code');
    expect(b.size()).toBe(2);
  });

  it('missing file starts empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fgb-bind-'));
    const path = join(dir, 'nope.json');
    const s = new FileBindingStore(path);
    expect(s.size()).toBe(0);
  });
});
