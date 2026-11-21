import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Shield } from 'lucide-react';
import { formatAudioDuration } from '../lib/audioUtils';
import type { ChatAttachment } from '../types';

interface VoiceMessagePlayerProps {
  attachment: ChatAttachment;
  isMine: boolean;
}

const WAVEFORM_BARS = [
  0.35, 0.72, 0.52, 0.9, 0.64, 0.42, 0.82, 0.95, 0.58, 0.44, 0.76, 0.88, 0.5,
  0.68, 0.92, 0.6, 0.4, 0.78, 0.55, 0.85, 0.48, 0.65, 0.72, 0.4,
];

export const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  attachment,
  isMine,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec, setTotalSec] = useState(attachment.durationSec ?? 0);
  const [speed, setSpeed] = useState<1 | 1.5>(1);

  useEffect(() => {
    const audio = new Audio(attachment.dataUrl);
    audioRef.current = audio;

    const handleLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalSec(Math.round(audio.duration));
      }
    };
    const handleTime = () => {
      const dur =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : attachment.durationSec || 1;
      setCurrentSec(Math.floor(audio.currentTime));
      setProgress(Math.min(1, audio.currentTime / dur));
    };
    const handleEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentSec(0);
    };

    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('ended', handleEnded);
      audioRef.current = null;
    };
  }, [attachment.dataUrl, attachment.durationSec]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.playbackRate = speed;
      void audio.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  function cycleSpeed() {
    const next: 1 | 1.5 = speed === 1 ? 1.5 : 1;
    setSpeed(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }

  function handleSeek(idx: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const dur =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : totalSec || 1;
    const ratio = (idx + 0.5) / WAVEFORM_BARS.length;
    audio.currentTime = ratio * dur;
    setProgress(ratio);
  }

  return (
    <div className="min-w-[220px] sm:min-w-[260px] space-y-1.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Mettre en pause' : 'Écouter la note vocale'}
          className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 ${
            isMine
              ? 'bg-white text-zinc-950 hover:bg-zinc-200'
              : 'glass-control text-white hover:border-white/30'
          }`}
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 fill-current ml-0.5" />
          )}
        </button>

        {/* Interactive Waveform */}
        <div
          className="flex-1 flex items-center gap-[3px] h-8 px-1"
          role="group"
          aria-label="Progression de la note vocale"
        >
          {WAVEFORM_BARS.map((height, idx) => {
            const barPos = idx / WAVEFORM_BARS.length;
            const active = barPos <= progress && progress > 0;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSeek(idx)}
                aria-label={`Aller à ${Math.round(barPos * 100)}%`}
                style={{ height: `${Math.round(height * 26)}px` }}
                className={`flex-1 min-w-[3px] rounded-full transition-colors cursor-pointer ${
                  active
                    ? isMine
                      ? 'bg-emerald-300'
                      : 'bg-white'
                    : isMine
                      ? 'bg-white/30 hover:bg-white/50'
                      : 'bg-white/25 hover:bg-white/45'
                }`}
              />
            );
          })}
        </div>

        <button
          type="button"
          onClick={cycleSpeed}
          title="Vitesse de lecture"
          className="glass-control h-7 px-2 rounded-lg font-mono text-[10px] font-semibold text-zinc-200 hover:text-white tabular-nums shrink-0 cursor-pointer"
        >
          {speed}×
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1 truncate">
          {attachment.voiceMasked && (
            <Shield className="h-3 w-3 text-emerald-400 shrink-0" />
          )}
          <span>
            {attachment.voiceMasked ? 'Voix anonymisée' : 'Note vocale chiffrée'}
          </span>
        </span>
        <span className="font-mono tabular-nums shrink-0">
          {playing || currentSec > 0
            ? `${formatAudioDuration(currentSec)} / ${formatAudioDuration(totalSec)}`
            : formatAudioDuration(totalSec)}
        </span>
      </div>
    </div>
  );
};
