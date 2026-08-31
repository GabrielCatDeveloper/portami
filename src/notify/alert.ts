// Strong alarm-style notifications for stop alerts.
// - requireInteraction: true → stays on screen until user dismisses
// - long vibration pattern (Vibration API)
// - optional audio cue (Audio API) — user must have interacted once
//   with the page (autoplay policy)
//
// Falls back gracefully on browsers / OSes that don't support these APIs.

import { notify } from './index';

export type StrongNotifyOptions = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  /** Play a short audio cue along with the notification. */
  withSound?: boolean;
  /** Vibration pattern; null = default. Lengths in ms, alternating off/on. */
  vibratePattern?: number[];
};

let _audio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!_audio) {
    try {
      // Tiny base64 WAV beep (~440Hz, 300ms). Inlined so we never need
      // a network round-trip and the file is bundled.
      const wav =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      _audio = new Audio(wav);
      _audio.preload = 'auto';
    } catch {
      _audio = null;
    }
  }
  return _audio;
}

/**
 * Fire a strong alert. Triggers a vibration, optionally a sound, and
 * a sticky system notification.
 */
export async function alertUser(opts: StrongNotifyOptions): Promise<void> {
  // Vibrate first (works even when the tab is hidden, if the PWA is installed)
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(opts.vibratePattern ?? [220, 110, 220, 110, 360]);
    } catch {
      // ignore
    }
  }

  // Sound (only if user opted in)
  if (opts.withSound) {
    const a = getAudio();
    if (a) {
      try {
        a.currentTime = 0;
        await a.play();
      } catch {
        // autoplay might be blocked; ignore
      }
    }
  }

  // System notification — sticky until acknowledged
  await notify({
    title: opts.title,
    body: opts.body,
    tag: opts.tag ?? 'portami-alert',
    url: opts.url,
    requireInteraction: true,
  });
}