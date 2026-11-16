import { useCallback, useEffect, useRef, useState } from 'react';

const TTS_AUTOREAD_KEY = 'discret_tts_autoread_v1';
const TTS_RATE_KEY = 'discret_tts_rate_v1';

export const TTS_RATES = [0.85, 1, 1.2, 1.4] as const;

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

function pickPreferredFrenchVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const frLocal = voices.find(
    (v) => v.lang.toLowerCase().startsWith('fr') && v.localService
  );
  if (frLocal) return frLocal;
  const frAny = voices.find((v) => v.lang.toLowerCase().startsWith('fr'));
  if (frAny) return frAny;
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}

export function useTextToSpeech() {
  const supported = isSpeechSynthesisSupported();

  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [autoRead, setAutoRead] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(TTS_AUTOREAD_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [rate, setRate] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(TTS_RATE_KEY));
      return TTS_RATES.includes(saved as (typeof TTS_RATES)[number]) ? saved : 1;
    } catch {
      return 1;
    }
  });

  const generationRef = useRef(0);
  const startTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!supported) return;

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) {
        setVoices(list);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', loadVoices);
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
      }
      window.speechSynthesis.cancel();
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    generationRef.current += 1;
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    window.speechSynthesis.cancel();
    setSpeakingMessageId(null);
  }, [supported]);

  const speakMessage = useCallback(
    (messageId: string, rawText: string, speakerPrefix?: string) => {
      if (!supported) return;
      const clean = rawText.trim();
      if (!clean) return;

      if (speakingMessageId === messageId) {
        stop();
        return;
      }

      const gen = generationRef.current + 1;
      generationRef.current = gen;

      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }

      const wasSpeaking =
        window.speechSynthesis.speaking || window.speechSynthesis.pending;
      window.speechSynthesis.cancel();
      setSpeakingMessageId(messageId);

      const startUtterance = () => {
        if (generationRef.current !== gen) return;

        const textToRead = speakerPrefix ? `${speakerPrefix} : ${clean}` : clean;
        const utterance = new window.SpeechSynthesisUtterance(textToRead);
        const preferred = pickPreferredFrenchVoice(
          voices.length > 0 ? voices : window.speechSynthesis.getVoices()
        );
        if (preferred) {
          utterance.voice = preferred;
          utterance.lang = preferred.lang;
        } else {
          utterance.lang = 'fr-FR';
        }
        utterance.rate = rate;
        utterance.pitch = 1;

        utterance.onend = () => {
          if (generationRef.current === gen) {
            setSpeakingMessageId(null);
          }
        };
        utterance.onerror = () => {
          if (generationRef.current === gen) {
            setSpeakingMessageId(null);
          }
        };

        // Ensure engine isn't stuck paused in some mobile/desktop browsers
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      };

      // Small delay avoids a Chromium quirk where cancel() + synchronous speak() drops the utterance
      if (wasSpeaking) {
        startTimerRef.current = window.setTimeout(startUtterance, 45);
      } else {
        startUtterance();
      }
    },
    [supported, speakingMessageId, stop, voices, rate]
  );

  const toggleAutoRead = useCallback(() => {
    setAutoRead((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TTS_AUTOREAD_KEY, String(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }, []);

  const cycleRate = useCallback(() => {
    setRate((prev) => {
      const idx = TTS_RATES.indexOf(prev as (typeof TTS_RATES)[number]);
      const next = TTS_RATES[(idx + 1) % TTS_RATES.length];
      try {
        window.localStorage.setItem(TTS_RATE_KEY, String(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }, []);

  return {
    supported,
    speakingMessageId,
    autoRead,
    rate,
    speakMessage,
    stop,
    toggleAutoRead,
    cycleRate,
  };
}
