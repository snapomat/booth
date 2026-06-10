import type React from 'react'
import { useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}

const rows = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['y', 'x', 'c', 'v', 'b', 'n', 'm']
]

/** Einfache On-Screen-Tastatur (QWERTZ) für Touch-Eingaben ohne OS-Keyboard. */
export default function OnScreenKeyboard({ value, onChange, onClose }: Props): React.JSX.Element {
  const [shift, setShift] = useState(false)
  const type = (ch: string): void => onChange(value + (shift ? ch.toUpperCase() : ch))

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 border-t border-cream/10 bg-ink-2 p-3 shadow-[0_-20px_40px_-20px_rgba(0,0,0,0.8)]">
      <div className="flex flex-col items-center gap-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1.5">
            {row.map((ch) => (
              <Key key={ch} onClick={() => type(ch)}>
                {shift ? ch.toUpperCase() : ch}
              </Key>
            ))}
          </div>
        ))}
        <div className="flex w-full max-w-[34rem] gap-1.5">
          <Key onClick={() => setShift((s) => !s)} active={shift} flex>
            ⇧
          </Key>
          <Key onClick={() => type(' ')} grow>
            Leer
          </Key>
          <Key onClick={() => onChange(value.slice(0, -1))} flex>
            ⌫
          </Key>
          <Key onClick={onClose} variant="ok" flex>
            Fertig
          </Key>
        </div>
      </div>
    </div>
  )
}

function Key({
  children,
  onClick,
  variant,
  active,
  grow,
  flex
}: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'ok'
  active?: boolean
  grow?: boolean
  flex?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`grid h-11 place-items-center rounded-lg font-body text-lg transition ${
        grow ? 'flex-[3]' : flex ? 'flex-1' : 'w-11'
      } ${
        variant === 'ok'
          ? 'bg-flare text-ink hover:bg-flare-deep'
          : active
            ? 'bg-flare/30 text-cream'
            : 'bg-cream/5 text-cream hover:bg-cream/15'
      }`}
    >
      {children}
    </button>
  )
}
