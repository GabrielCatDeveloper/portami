// ============================================================
// Tests for the invite deeplink helpers (Hito 7 — Fase 6).
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseInviteLink,
  parseAnswerBackLink,
  buildAnswerBackUrl,
  defaultInviteText,
  defaultAnswerBackText,
  whatsappShareUrl,
  telegramShareUrl,
  smsShareUrl,
  INVITE_VERSION,
} from '@/sync/invite';

const SAMPLE_OFFER = JSON.stringify({
  type: 'offer',
  sdp: 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-\nt=0 0\n',
});

const SAMPLE_ANSWER = JSON.stringify({
  type: 'answer',
  sdp: 'v=0\no=- 1 1 IN IP4 127.0.0.1\ns=-\nt=0 0\n',
});

function encodeBase64Url(s: string): string {
  // Minimal base64url encoder used only inside tests (mirrors
  // bytesToBase64Url in @/crypto).
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('parseInviteLink', () => {
  it('parses a well-formed invite URL', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(SAMPLE_OFFER),
      u: 'emitter-anon',
      a: 'Carlos',
      t: 'share-123',
      v: INVITE_VERSION,
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.offer).toBe(SAMPLE_OFFER);
    expect(r.emitterAnonId).toBe('emitter-anon');
    expect(r.emitterAlias).toBe('Carlos');
    expect(r.tripShareId).toBe('share-123');
    expect(r.version).toBe(INVITE_VERSION);
  });

  it('treats empty a/t as undefined (not empty string)', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(SAMPLE_OFFER),
      u: 'emitter-anon',
      v: INVITE_VERSION,
    });
    const r = parseInviteLink(params);
    if (!r.ok) throw new Error('expected ok');
    expect(r.emitterAlias).toBeUndefined();
    expect(r.tripShareId).toBeUndefined();
  });

  it('rejects an unknown version', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(SAMPLE_OFFER),
      u: 'emitter-anon',
      v: '2',
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/version/i);
  });

  it('rejects a missing version', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(SAMPLE_OFFER),
      u: 'emitter-anon',
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
  });

  it('rejects missing o', () => {
    const params = new URLSearchParams({ u: 'x', v: INVITE_VERSION });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/missing/);
  });

  it('rejects missing u', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(SAMPLE_OFFER),
      v: INVITE_VERSION,
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed (non-JSON) offer payload', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url('not json'),
      u: 'x',
      v: INVITE_VERSION,
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/valid base64|malformed/i);
  });

  it('rejects an offer with wrong shape (no type=sdp)', () => {
    const params = new URLSearchParams({
      o: encodeBase64Url(JSON.stringify({ type: 'answer', sdp: 'v=0' })),
      u: 'x',
      v: INVITE_VERSION,
    });
    const r = parseInviteLink(params);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/malformed/i);
  });

  it('accepts an absolute URL', () => {
    const url = `https://portami.app/connect?o=${encodeBase64Url(SAMPLE_OFFER)}&u=emitter&v=${INVITE_VERSION}`;
    const r = parseInviteLink(url);
    expect(r.ok).toBe(true);
  });
});

describe('parseAnswerBackLink', () => {
  it('parses a well-formed answer-back URL', () => {
    const params = new URLSearchParams({
      a: encodeBase64Url(SAMPLE_ANSWER),
      for: 'emitter-anon',
      v: INVITE_VERSION,
    });
    const r = parseAnswerBackLink(params);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toBe(SAMPLE_ANSWER);
    expect(r.forAnonId).toBe('emitter-anon');
  });

  it('rejects malformed answer payload', () => {
    const params = new URLSearchParams({
      a: encodeBase64Url('not json'),
      for: 'x',
      v: INVITE_VERSION,
    });
    const r = parseAnswerBackLink(params);
    expect(r.ok).toBe(false);
  });

  it('rejects missing for', () => {
    const params = new URLSearchParams({
      a: encodeBase64Url(SAMPLE_ANSWER),
      v: INVITE_VERSION,
    });
    const r = parseAnswerBackLink(params);
    expect(r.ok).toBe(false);
  });

  it('rejects answer with wrong type', () => {
    const params = new URLSearchParams({
      a: encodeBase64Url(JSON.stringify({ type: 'offer', sdp: 'v=0' })),
      for: 'x',
      v: INVITE_VERSION,
    });
    const r = parseAnswerBackLink(params);
    expect(r.ok).toBe(false);
  });
});

describe('buildAnswerBackUrl', () => {
  it('builds a URL whose params round-trip through parseAnswerBackLink', () => {
    const url = buildAnswerBackUrl({
      emitterAnonId: 'emitter-anon',
      answer: SAMPLE_ANSWER,
      baseUrl: 'https://portami.app/portami/',
    });
    expect(url).toMatch(/^https:\/\/portami\.app\/portami\/connect-back\?/);
    const parsed = parseAnswerBackLink(url);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.answer).toBe(SAMPLE_ANSWER);
    expect(parsed.forAnonId).toBe('emitter-anon');
  });
});

describe('defaultInviteText', () => {
  it('renders Spanish by default', () => {
    const t = defaultInviteText({ emitterAlias: 'Carlos', inviteUrl: 'https://x' });
    expect(t).toMatch(/portami/);
    expect(t).toContain('https://x');
  });

  it('renders English when language=en', () => {
    const t = defaultInviteText({
      emitterAlias: 'Carlos',
      inviteUrl: 'https://x',
      language: 'en',
    });
    expect(t).toMatch(/open portami/i);
  });

  it('renders Catalan when language=ca', () => {
    const t = defaultInviteText({
      emitterAlias: 'Carlos',
      inviteUrl: 'https://x',
      language: 'ca',
    });
    expect(t).toMatch(/obre'm portami/i);
  });
});

describe('defaultAnswerBackText', () => {
  it('contains the answer-back URL', () => {
    const t = defaultAnswerBackText({
      emitterAlias: 'X',
      answerBackUrl: 'https://portami.app/portami/connect-back?a=abc',
    });
    expect(t).toContain('https://portami.app/portami/connect-back?a=abc');
  });
});

describe('share URL builders', () => {
  it('whatsapp URL has wa.me and encoded text', () => {
    const url = whatsappShareUrl('hello world & more');
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(url).toContain(encodeURIComponent('hello world & more'));
  });

  it('telegram URL has separate url and text params', () => {
    const url = telegramShareUrl('hi', 'https://x');
    expect(url).toMatch(/^https:\/\/t\.me\/share\/url\?/);
    expect(url).toContain('url=' + encodeURIComponent('https://x'));
    expect(url).toContain('text=' + encodeURIComponent('hi'));
  });

  it('sms URL has sms: scheme with body', () => {
    const url = smsShareUrl('hello');
    expect(url).toMatch(/^sms:\?body=/);
    expect(url).toContain(encodeURIComponent('hello'));
  });
});
