import { describe, it, expect } from 'vitest';
import { normalizeCardAction, buildBotPickerCard, SELECT_BOT_ACTION } from '../src/feishu/card.js';

describe('normalizeCardAction', () => {
  it('parses schema 2.0 card.action.trigger', () => {
    const action = normalizeCardAction({
      schema: '2.0',
      event_id: 'ev_card_1',
      header: { event_type: 'card.action.trigger', event_id: 'ev_card_1' },
      event: {
        operator: { open_id: 'ou_alice' },
        token: 'c-tok',
        action: {
          tag: 'button',
          value: { action: SELECT_BOT_ACTION, agentId: 'echo-2' },
        },
        context: {
          open_chat_id: 'oc_1',
          open_message_id: 'om_card',
        },
      },
    });
    expect(action).toEqual({
      eventId: 'ev_card_1',
      openId: 'ou_alice',
      chatId: 'oc_1',
      messageId: 'om_card',
      chatType: 'p2p',
      action: SELECT_BOT_ACTION,
      agentId: 'echo-2',
    });
  });

  it('returns null without chat or user', () => {
    expect(normalizeCardAction({ event: { action: { value: { agentId: 'x' } } } })).toBeNull();
  });
});

describe('buildBotPickerCard', () => {
  it('includes button values with agentId', () => {
    const card = buildBotPickerCard(
      [{ id: 'echo-1', name: 'Echo One', enabled: true }],
      'echo-1',
    );
    const json = JSON.stringify(card);
    expect(json).toContain('echo-1');
    expect(json).toContain(SELECT_BOT_ACTION);
  });
});
