import React from 'react';
import { useAppTheme } from '../lib/appTheme';

const EMBER_MOTES = [
  { left: '10%', bottom: '8%', size: 4, dur: '8.5s', delay: '0s', color: 'rgba(251, 191, 36, 0.72)' },
  { left: '22%', bottom: '12%', size: 3, dur: '10.2s', delay: '1.4s', color: 'rgba(251, 146, 60, 0.68)' },
  { left: '34%', bottom: '6%', size: 5, dur: '11.4s', delay: '0.6s', color: 'rgba(253, 224, 71, 0.6)' },
  { left: '48%', bottom: '10%', size: 3.5, dur: '9.1s', delay: '2.2s', color: 'rgba(251, 113, 133, 0.58)' },
  { left: '62%', bottom: '7%', size: 4.5, dur: '10.8s', delay: '0.9s', color: 'rgba(245, 158, 11, 0.7)' },
  { left: '74%', bottom: '14%', size: 3, dur: '8.8s', delay: '3.1s', color: 'rgba(253, 186, 116, 0.65)' },
  { left: '86%', bottom: '9%', size: 4, dur: '11.8s', delay: '1.8s', color: 'rgba(251, 191, 36, 0.65)' },
  { left: '16%', bottom: '28%', size: 3, dur: '12.5s', delay: '2.8s', color: 'rgba(251, 146, 60, 0.5)' },
  { left: '56%', bottom: '25%', size: 3.5, dur: '9.7s', delay: '3.9s', color: 'rgba(253, 224, 71, 0.55)' },
  { left: '81%', bottom: '32%', size: 3, dur: '11.2s', delay: '0.3s', color: 'rgba(251, 113, 133, 0.5)' },
] as const;

interface ThemeBackdropProps {
  showTopSheen?: boolean;
}

export const ThemeBackdrop: React.FC<ThemeBackdropProps> = ({
  showTopSheen = false,
}) => {
  const [appTheme] = useAppTheme();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden"
    >
      <div className="liquid-orb-a ambient-orb-a absolute -top-48 left-[12%] h-[540px] w-[720px] rounded-full blur-[145px]" />
      <div className="liquid-orb-b ambient-orb-b absolute top-[28%] right-[8%] h-[460px] w-[560px] rounded-full blur-[150px]" />
      <div className="liquid-orb-c ambient-orb-c absolute -bottom-44 left-[26%] h-[440px] w-[580px] rounded-full blur-[150px]" />

      {appTheme === 'borealis' && (
        <>
          <div className="theme-aurora-curtain-1 absolute -top-28 -left-24 h-[65vh] w-[130vw] blur-[88px]" />
          <div className="theme-aurora-curtain-2 absolute top-[18%] -right-24 h-[55vh] w-[115vw] blur-[96px]" />
        </>
      )}

      {appTheme === 'prism' && (
        <>
          <div className="theme-prism-ring absolute top-1/2 left-1/2 h-[78vmax] w-[78vmax] rounded-full blur-[110px] opacity-45" />
          <div className="theme-prism-beam absolute inset-[-20%] blur-[60px]" />
        </>
      )}

      {appTheme === 'nebula' && (
        <>
          <div className="theme-nebula-stars-a absolute inset-0" />
          <div className="theme-nebula-stars-b absolute inset-0" />
        </>
      )}

      {appTheme === 'ember' && (
        <>
          <div className="theme-ember-glow absolute inset-x-0 bottom-0 h-[55vh] blur-[90px]" />
          {EMBER_MOTES.map((mote, i) => (
            <span
              key={i}
              className="theme-ember-mote absolute rounded-full blur-[0.5px]"
              style={
                {
                  left: mote.left,
                  bottom: mote.bottom,
                  width: `${mote.size}px`,
                  height: `${mote.size}px`,
                  backgroundColor: mote.color,
                  boxShadow: `0 0 12px ${mote.color}`,
                  '--ember-dur': mote.dur,
                  '--ember-delay': mote.delay,
                } as React.CSSProperties
              }
            />
          ))}
        </>
      )}

      {showTopSheen && <div className="ambient-sheen absolute inset-0" />}
    </div>
  );
};
