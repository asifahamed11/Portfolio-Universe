/// <reference types="astro/client" />

interface Window {
  dataLayer: unknown[];
  openLoginModal?: () => void;
  openSubmitModal?: () => void;
  playPopSound?: (volume?: number) => void;
  showToast?: (
    message: string,
    icon?: 'check' | 'heart' | 'error',
  ) => void;
  toggleBookmark?: (
    button: HTMLButtonElement,
    url?: string,
  ) => Promise<void>;
  triggerSpark?: (element: Element) => void;
  webkitAudioContext?: typeof AudioContext;
}
