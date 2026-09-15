import type { PointerEvent } from "react";

interface StraightKeyProps {
  down: boolean;
  disabled?: boolean;
  onDown: () => void;
  onUp: () => void;
}

export function StraightKey({ down, disabled, onDown, onUp }: StraightKeyProps) {
  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onDown();
  };

  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) && !down) return;
    onUp();
  };

  return (
    <button
      type="button"
      className={`straight-key ${down ? "is-down" : ""} ${disabled ? "is-disabled" : ""}`}
      aria-label="Straight key"
      aria-pressed={down}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="key-base" aria-hidden="true">
        <span className="key-post key-post-l" />
        <span className="key-post key-post-r" />
        <span className="key-fulcrum" />
        <span className="key-spring" />
        <span className="key-lever">
          <span className="key-arm" />
          <span className="key-knob">
            <span className="key-knob-shine" />
          </span>
        </span>
        <span className={`key-contact ${down ? "is-spark" : ""}`} />
      </span>
      <span className="key-caption">{down ? "TX" : "HOLD TO TRANSMIT"}</span>
    </button>
  );
}
