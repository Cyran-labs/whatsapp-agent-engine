'use client';

import { useRef } from 'react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange(value: string): void;
  ariaLabel: string;
}

/** Contrôle à deux positions ou plus, une seule valeur choisie (groupe radio). */
export function Segmented({ options, value, onChange, ariaLabel }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`px-4 py-[7px] text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              index > 0 ? 'border-l border-border-strong' : ''
            } ${checked ? 'bg-brand text-[#E6EFEA]' : 'text-muted hover:bg-surface-subtle'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
