import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';

interface CamouflageScreenProps {
  secretCode: string;
  onExit: () => void;
}

export function normalizeCamouflageCode(raw: string): string {
  return raw
    .replace(/\*/g, '×')
    .replace(/\//g, '÷')
    .replace(/[^0-9.+\-×÷]/g, '')
    .slice(0, 12);
}

export const CamouflageScreen: React.FC<CamouflageScreenProps> = ({
  secretCode,
  onExit,
}) => {
  const [display, setDisplay] = useState('0');
  const [storedVal, setStoredVal] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<'+' | '-' | '×' | '÷' | null>(null);
  const [resetNext, setResetNext] = useState(false);
  const [scratchNote, setScratchNote] = useState('');

  const sequenceRef = useRef('');
  const normalizedTarget = normalizeCamouflageCode(secretCode) || '1337';

  const pushSequenceToken = useCallback((token: string) => {
    const next = `${sequenceRef.current}${token}`;
    sequenceRef.current = next.length > 32 ? next.slice(-32) : next;
  }, []);

  const inputDigit = useCallback(
    (d: string) => {
      pushSequenceToken(d);
      setDisplay((prev) => {
        if (resetNext || prev === '0') {
          return d === '.' ? '0.' : d;
        }
        if (d === '.' && prev.includes('.')) return prev;
        if (prev.length >= 14) return prev;
        return `${prev}${d}`;
      });
      setResetNext(false);
    },
    [pushSequenceToken, resetNext]
  );

  const clearAll = useCallback(() => {
    sequenceRef.current = '';
    setDisplay('0');
    setStoredVal(null);
    setPendingOp(null);
    setResetNext(false);
  }, []);

  const backspace = useCallback(() => {
    if (sequenceRef.current.length > 0) {
      sequenceRef.current = sequenceRef.current.slice(0, -1);
    }
    if (resetNext || display.length <= 1) {
      setDisplay('0');
      setResetNext(false);
      return;
    }
    setDisplay((prev) => prev.slice(0, -1));
  }, [display.length, resetNext]);

  const applyOp = useCallback(
    (nextOp: '+' | '-' | '×' | '÷' | '=') => {
      if (nextOp === '=') {
        if (sequenceRef.current.endsWith(normalizedTarget)) {
          sequenceRef.current = '';
          onExit();
          return;
        }
        sequenceRef.current = '';
      } else {
        pushSequenceToken(nextOp);
      }

      const current = parseFloat(display);
      if (Number.isNaN(current)) return;

      let result = current;
      if (storedVal !== null && pendingOp) {
        if (pendingOp === '+') result = storedVal + current;
        else if (pendingOp === '-') result = storedVal - current;
        else if (pendingOp === '×') result = storedVal * current;
        else if (pendingOp === '÷') result = current === 0 ? 0 : storedVal / current;
      }

      const formatted = Number.isInteger(result)
        ? String(result)
        : String(Number(result.toFixed(8)));
      setDisplay(formatted);
      setStoredVal(nextOp === '=' ? null : result);
      setPendingOp(nextOp === '=' ? null : nextOp);
      setResetNext(true);
    },
    [display, normalizedTarget, onExit, pendingOp, pushSequenceToken, storedVal]
  );

  // Keyboard support for desktop calculator input without exiting on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        e.preventDefault();
        inputDigit(e.key);
      } else if (e.key === ',') {
        e.preventDefault();
        inputDigit('.');
      } else if (e.key === '+' || e.key === '-') {
        e.preventDefault();
        applyOp(e.key);
      } else if (e.key === '*' || e.key.toLowerCase() === 'x') {
        e.preventDefault();
        applyOp('×');
      } else if (e.key === '/') {
        e.preventDefault();
        applyOp('÷');
      } else if (e.key === '=' || e.key === 'Enter') {
        e.preventDefault();
        applyOp('=');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        clearAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyOp, backspace, clearAll, inputDigit]);

  const keys = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '⌫', '='],
  ] as const;

  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950 text-zinc-100 flex flex-col overflow-y-auto">
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-zinc-500" aria-hidden="true" />
          <span className="text-sm font-medium tracking-tight text-zinc-200">
            Calculatrice &amp; Notes
          </span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-3xl grid md:grid-cols-[340px_1fr] gap-5 items-stretch">
          {/* Functional Calculator */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 flex flex-col gap-3">
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 px-4 py-3 text-right">
              <div className="h-4 text-[11px] font-mono text-zinc-500 tabular-nums">
                {storedVal !== null && pendingOp ? `${storedVal} ${pendingOp}` : ''}
              </div>
              <div className="mt-1 font-mono text-3xl font-semibold text-white truncate tabular-nums">
                {display}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {keys.flat().map((key) => {
                const isOp = ['÷', '×', '-', '+', '='].includes(key);
                const isFn = ['C', '±', '%'].includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      if (key === 'C') clearAll();
                      else if (key === '⌫') backspace();
                      else if (key === '±') {
                        setDisplay((v) =>
                          v.startsWith('-') ? v.slice(1) : v === '0' ? '0' : `-${v}`
                        );
                      } else if (key === '%') {
                        const num = parseFloat(display);
                        if (!Number.isNaN(num)) setDisplay(String(num / 100));
                      } else if (
                        key === '+' ||
                        key === '-' ||
                        key === '×' ||
                        key === '÷' ||
                        key === '='
                      ) {
                        applyOp(key);
                      } else {
                        inputDigit(key);
                      }
                    }}
                    className={`h-12 rounded-xl text-sm font-medium transition-colors cursor-pointer flex items-center justify-center ${
                      key === '='
                        ? 'bg-zinc-100 text-zinc-950 hover:bg-white font-semibold'
                        : isOp
                          ? 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                          : isFn
                            ? 'bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800'
                            : 'bg-zinc-950/70 border border-zinc-800/80 text-zinc-100 hover:bg-zinc-800/70'
                    }`}
                  >
                    {key === '⌫' ? <Delete className="h-4 w-4" /> : key}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Neutral Scratchpad */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 flex flex-col min-h-[260px]">
            <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800">
              <span className="text-xs font-medium text-zinc-300">
                Bloc-notes temporaire
              </span>
              <span className="text-[11px] text-zinc-500">
                Non enregistré
              </span>
            </div>
            <textarea
              value={scratchNote}
              onChange={(e) => setScratchNote(e.target.value)}
              placeholder="Saisissez vos calculs, brouillons ou rappels rapides..."
              className="mt-3 flex-1 w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
