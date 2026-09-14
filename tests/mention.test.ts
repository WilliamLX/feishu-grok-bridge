import { describe, it, expect } from 'vitest';
import { parseMentions, isAddressedToBot } from '../src/feishu/mention.js';

describe('parseMentions', () => {
  it('strips mention keys and detects bot', () => {
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
