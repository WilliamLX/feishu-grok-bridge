import { describe, it, expect } from 'vitest';
import { parseMentions, isAddressedToBot, normalizeMentionId } from '../src/feishu/mention.js';

describe('parseMentions', () => {
  it('strips mention keys and detects bot when botOpenId known', () => {
    const info = parseMentions(
      {
        message: {
          content: JSON.stringify({ text: '@_user_1 please help' }),
          mentions: [{ key: '@_user_1', id: 'ou_bot', name: 'Grok' }],
        },
      },
      'ou_bot',
    );
    expect(info.mentionedBot).toBe(true);
    expect(info.text).toBe('please help');
  });

  it('does not treat other user mentions as bot when botOpenId known', () => {
    const info = parseMentions(
      {
        message: {
          content: JSON.stringify({ text: '@_user_1 hi' }),
          mentions: [{ key: '@_user_1', id: 'ou_alice', name: 'Alice' }],
        },
      },
      'ou_bot',
    );
    expect(info.mentionedBot).toBe(false);
    expect(info.text).toBe('hi');
  });

  it('mentionedBot stays false when botOpenId unknown (no false positives)', () => {
    const info = parseMentions({
      message: {
        content: JSON.stringify({ text: '@_user_1 ping' }),
        mentions: [{ key: '@_user_1', id: 'ou_someone', name: 'Someone' }],
      },
    });
    expect(info.mentionedBot).toBe(false);
    expect(info.text).toBe('ping');
  });


  it('normalizes mentions[].id object {open_id} to string', () => {
    const info = parseMentions(
      {
        message: {
          content: JSON.stringify({ text: '@_user_1 please help' }),
          mentions: [
            {
              key: '@_user_1',
              // Real Feishu payload shape
              id: { open_id: 'ou_bot', user_id: 'u_bot' },
              name: 'Grok',
            },
          ],
        },
      },
      'ou_bot',
    );
    expect(info.mentionedBot).toBe(true);
    expect(info.mentions[0]?.id).toBe('ou_bot');
    expect(info.text).toBe('please help');
  });

  it('handles plain content without mentions', () => {
    const info = parseMentions({
      message: { content: JSON.stringify({ text: 'hi' }), mentions: [] },
    });
    expect(info.mentionedBot).toBe(false);
    expect(info.text).toBe('hi');
  });
});

describe('isAddressedToBot', () => {
  it('always true for p2p', () => {
    expect(
      isAddressedToBot({ chatType: 'p2p', mentionedBot: false, requireMention: true }),
    ).toBe(true);
  });

  it('respects requireMention in groups', () => {
    expect(
      isAddressedToBot({ chatType: 'group', mentionedBot: false, requireMention: true }),
    ).toBe(false);
    expect(
      isAddressedToBot({ chatType: 'group', mentionedBot: true, requireMention: true }),
    ).toBe(true);
  });
});

describe('normalizeMentionId', () => {
  it('accepts string and {open_id} object', () => {
    expect(normalizeMentionId('ou_x')).toBe('ou_x');
    expect(normalizeMentionId({ open_id: 'ou_y' })).toBe('ou_y');
    expect(normalizeMentionId({ user_id: 'only_user' })).toBe('');
    expect(normalizeMentionId(undefined)).toBe('');
  });
});
