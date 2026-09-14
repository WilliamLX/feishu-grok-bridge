import { describe, it, expect } from 'vitest';
import { extractEventId, normalizeReceiveV1 } from '../src/feishu/ws.js';

describe('extractEventId', () => {
  it('prefers top-level event_id', () => {
    expect(extractEventId({ event_id: 'ev_top', message: {} }, 'om_fallback')).toBe('ev_top');
  });

  it('reads header.event_id from envelope', () => {
    expect(
      extractEventId({ header: { event_id: 'ev_hdr' }, event: {} }, 'om_fallback'),
    ).toBe('ev_hdr');
  });

  it('falls back to message_id', () => {
    expect(extractEventId({ foo: 1 }, 'om_x')).toBe('om_x');
  });
});

describe('normalizeReceiveV1', () => {
  const baseMsg = {
    sender: { sender_id: { open_id: 'ou_user' } },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hi' }),
      mentions: [],
    },
  };

  it('uses header event_id when present on envelope', () => {
    const msg = normalizeReceiveV1({
      header: { event_id: 'ev_envelope' },
      event: baseMsg,
    });
    expect(msg?.eventId).toBe('ev_envelope');
    expect(msg?.messageId).toBe('om_1');
    expect(msg?.openId).toBe('ou_user');
  });

  it('falls back to message_id when no event_id', () => {
    const msg = normalizeReceiveV1(baseMsg);
    expect(msg?.eventId).toBe('om_1');
  });

  it('normalizes mentions[].id object to string open_id', () => {
    const msg = normalizeReceiveV1({
      ...baseMsg,
      message: {
        ...baseMsg.message,
        chat_type: 'group',
        content: JSON.stringify({ text: '@_user_1 hi' }),
        mentions: [
          {
            key: '@_user_1',
            id: { open_id: 'ou_bot', user_id: 'u_bot' },
            name: 'Bot',
          },
        ],
      },
    });
    expect(msg?.mentions).toEqual([
      { key: '@_user_1', id: 'ou_bot', name: 'Bot' },
    ]);
  });

});