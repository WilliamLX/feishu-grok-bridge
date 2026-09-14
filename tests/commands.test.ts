import { describe, it, expect } from 'vitest';
import { parseCommand, helpText, isKnownCommand } from '../src/core/commands.js';

describe('parseCommand', () => {
  it('parses known commands', () => {
    expect(parseCommand('/help')).toEqual({ type: 'command', name: 'help', args: '' });
    expect(parseCommand('/new')).toEqual({ type: 'command', name: 'new', args: '' });
    expect(parseCommand('/status')).toEqual({ type: 'command', name: 'status', args: '' });
    expect(parseCommand('/whoami')).toEqual({ type: 'command', name: 'whoami', args: '' });
    expect(parseCommand('/stop')).toEqual({ type: 'command', name: 'stop', args: '' });
  });

  it('captures args', () => {
    expect(parseCommand('/new foo bar')).toEqual({
      type: 'command',
      name: 'new',
      args: 'foo bar',
    });
  });

  it('treats unknown slash as message', () => {
    expect(parseCommand('/foo')).toEqual({ type: 'message', text: '/foo' });
  });

  it('treats plain text as message', () => {
    expect(parseCommand('hello world')).toEqual({ type: 'message', text: 'hello world' });
  });

  it('trims whitespace', () => {
    expect(parseCommand('  /help  ')).toEqual({ type: 'command', name: 'help', args: '' });
  });
});

describe('helpText / isKnownCommand', () => {
  it('help mentions all commands', () => {
    const h = helpText();
    for (const c of ['/help', '/new', '/status', '/whoami', '/stop']) {
      expect(h).toContain(c);
    }
  });

  it('isKnownCommand', () => {
    expect(isKnownCommand('help')).toBe(true);
    expect(isKnownCommand('nope')).toBe(false);
  });
});
