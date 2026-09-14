import { describe, it, expect } from 'vitest';
import { checkAcl, type AclConfig } from '../src/core/acl.js';

const base: AclConfig = {
  allowFrom: ['ou_alice', 'ou_bob'],
  allowChats: [],
  requireMention: true,
};

describe('checkAcl', () => {
  it('denies everyone when ALLOW_FROM is empty (fail-closed)', () => {
    const r = checkAcl(
      { ...base, allowFrom: [] },
      { openId: 'ou_alice', chatId: 'oc_1', chatType: 'p2p', mentionedBot: true },
    );
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/ALLOW_FROM is empty/);
  });

  it('allows listed open_id in DM', () => {
    const r = checkAcl(base, {
      openId: 'ou_alice',
      chatId: 'oc_1',
      chatType: 'p2p',
      mentionedBot: false,
    });
    expect(r.allowed).toBe(true);
  });

  it('denies unlisted open_id', () => {
    const r = checkAcl(base, {
      openId: 'ou_eve',
      chatId: 'oc_1',
      chatType: 'p2p',
      mentionedBot: true,
    });
    expect(r.allowed).toBe(false);
  });

  it('enforces ALLOW_CHATS when non-empty', () => {
    const cfg = { ...base, allowChats: ['oc_allowed'] };
    expect(
      checkAcl(cfg, {
        openId: 'ou_alice',
        chatId: 'oc_other',
        chatType: 'p2p',
        mentionedBot: true,
      }).allowed,
    ).toBe(false);
    expect(
      checkAcl(cfg, {
        openId: 'ou_alice',
        chatId: 'oc_allowed',
        chatType: 'p2p',
        mentionedBot: true,
      }).allowed,
    ).toBe(true);
  });

  it('requires mention in groups when REQUIRE_MENTION=true', () => {
    const denied = checkAcl(base, {
      openId: 'ou_alice',
      chatId: 'oc_g',
      chatType: 'group',
      mentionedBot: false,
    });
    expect(denied.allowed).toBe(false);

    const ok = checkAcl(base, {
      openId: 'ou_alice',
      chatId: 'oc_g',
      chatType: 'group',
      mentionedBot: true,
    });
    expect(ok.allowed).toBe(true);
  });

  it('skips mention requirement when REQUIRE_MENTION=false', () => {
    const r = checkAcl(
      { ...base, requireMention: false },
      { openId: 'ou_alice', chatId: 'oc_g', chatType: 'group', mentionedBot: false },
    );
    expect(r.allowed).toBe(true);
  });
});
