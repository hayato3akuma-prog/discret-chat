import type { ChatAttachment } from '../types';

const MAX_AUDIO_DATA_URL_LEN = 230_000;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Impossible de lire le fichier audio.'));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture audio.'));
    reader.readAsDataURL(blob);
  });
}

function encodeMonoWav(
  samples: Float32Array,
  sampleRate: number,
  bitsPerSample: 8 | 16
): Uint8Array {
  const numSamples = samples.length;
  const bytesPerSample = bitsPerSample === 16 ? 2 : 1;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  if (bitsPerSample === 16) {
    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  } else {
    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setUint8(offset, Math.round((clamped * 0.5 + 0.5) * 255));
      offset += 1;
    }
  }

  return new Uint8Array(buffer);
}

/**
 * Masks the speaker's natural vocal timbre client-side before E2EE encryption
 * by shifting pitch down via OfflineAudioContext resampling and shaping formants.
 */
async function renderMaskedVoiceWavDataUrl(blob: Blob): Promise<{
  dataUrl: string;
  mimeType: string;
  durationSec: number;
}> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const decodeCtx = new AudioCtx();

  try {
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    const durationSec = Math.max(1, Math.round(decoded.duration));

    // Pitch-down factor (~ -4 semitones) for realistic vocal anonymization
    const pitchFactor = 0.78;
    const sampleRates: Array<{ rate: number; bits: 8 | 16 }> = [
      { rate: 11025, bits: 16 },
      { rate: 8000, bits: 16 },
      { rate: 8000, bits: 8 },
    ];

    for (const preset of sampleRates) {
      const targetFrames = Math.max(
        1,
        Math.ceil((decoded.duration / pitchFactor) * preset.rate)
      );
      const offline = new OfflineAudioContext(1, targetFrames, preset.rate);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.playbackRate.value = pitchFactor;

      const lowpass = offline.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 2600;

      const highpass = offline.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 95;

      src.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(offline.destination);
      src.start(0);

      const rendered = await offline.startRendering();
      const channel = rendered.getChannelData(0);

      // Peak normalize gently for clarity
      let peak = 0;
      for (let i = 0; i < channel.length; i++) {
        const abs = Math.abs(channel[i]);
        if (abs > peak) peak = abs;
      }
      if (peak > 0.01) {
        const gain = Math.min(2.2, 0.88 / peak);
        for (let i = 0; i < channel.length; i++) {
          channel[i] = Math.max(-1, Math.min(1, channel[i] * gain));
        }
      }

      const wavBytes = encodeMonoWav(channel, preset.rate, preset.bits);
      const dataUrl = `data:audio/wav;base64,${uint8ToBase64(wavBytes)}`;
      if (dataUrl.length <= MAX_AUDIO_DATA_URL_LEN) {
        return {
          dataUrl,
          mimeType: 'audio/wav',
          durationSec: Math.max(1, Math.round(rendered.duration)),
        };
      }
    }

    throw new Error(
      'Note vocale anonymisée trop longue (maximum ~18 secondes en mode voix masquée).'
    );
  } finally {
    void decodeCtx.close().catch(() => {});
  }
}

export async function prepareVoiceAttachment(params: {
  blob: Blob;
  durationSec: number;
  maskVoice: boolean;
}): Promise<ChatAttachment> {
  if (params.maskVoice) {
    const masked = await renderMaskedVoiceWavDataUrl(params.blob);
    return {
      kind: 'audio',
      dataUrl: masked.dataUrl,
      mimeType: masked.mimeType,
      durationSec: masked.durationSec,
      voiceMasked: true,
    };
  }

  const rawDataUrl = await blobToDataUrl(params.blob);
  if (rawDataUrl.length <= MAX_AUDIO_DATA_URL_LEN) {
    const mime =
      params.blob.type && params.blob.type.startsWith('audio/')
        ? params.blob.type.split(';')[0]
        : 'audio/webm';
    return {
      kind: 'audio',
      dataUrl: rawDataUrl,
      mimeType: mime,
      durationSec: Math.max(1, Math.round(params.durationSec)),
      voiceMasked: false,
    };
  }

  throw new Error(
    'Note vocale trop volumineuse pour le chiffrement (maximum ~40 secondes).'
  );
}

export function formatAudioDuration(sec?: number): string {
  const safe = Math.max(0, Math.round(sec ?? 0));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}
