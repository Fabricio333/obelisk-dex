/**
 * Module-level singleton for the currently-active VoiceClient. Set by
 * VoiceRoom on join, cleared on leave. Anything outside the room (sidebar
 * status bar, hotkeys, etc.) reaches the live call through this.
 */
import type { VoiceClient } from './client';

let active: VoiceClient | null = null;

export function setActiveVoiceClient(client: VoiceClient | null): void {
  active = client;
}

export function getActiveVoiceClient(): VoiceClient | null {
  return active;
}
