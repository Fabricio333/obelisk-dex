import { create } from 'zustand';

interface VoiceState {
  /** Channel id of the call we're currently in, or null if not in any call. */
  currentVoiceChannelId: string | null;
  /** Mic enabled? Mirror of VoiceClient.getLocalTracks().mic, kept in store so
   *  the sidebar status bar can re-render without owning the client. */
  isMuted: boolean;
  /** Output silenced (incoming audio not played). Local-only — does not
   *  affect what we publish. */
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isConnecting: boolean;
  error: string | null;
  /** Whether the right-side text-chat rail is visible inside the voice room. */
  isVoiceChatOpen: boolean;

  setVoiceChannel: (channelId: string | null) => void;
  setMuted: (muted: boolean) => void;
  setDeafened: (deafened: boolean) => void;
  setCameraOn: (on: boolean) => void;
  setScreenSharing: (on: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setVoiceChatOpen: (open: boolean) => void;
  /** Reset to defaults — called when the call ends. */
  leaveVoice: () => void;
}

export const useVoiceStore = create<VoiceState>()((set) => ({
  currentVoiceChannelId: null,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  isConnecting: false,
  error: null,
  isVoiceChatOpen: false,

  setVoiceChannel: (currentVoiceChannelId) => set({ currentVoiceChannelId }),
  setMuted: (isMuted) => set({ isMuted }),
  setDeafened: (isDeafened) => set({ isDeafened }),
  setCameraOn: (isCameraOn) => set({ isCameraOn }),
  setScreenSharing: (isScreenSharing) => set({ isScreenSharing }),
  setConnecting: (isConnecting) => set({ isConnecting }),
  setError: (error) => set({ error }),
  setVoiceChatOpen: (isVoiceChatOpen) => set({ isVoiceChatOpen }),
  leaveVoice: () =>
    set({
      currentVoiceChannelId: null,
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      isConnecting: false,
      error: null,
    }),
}));
