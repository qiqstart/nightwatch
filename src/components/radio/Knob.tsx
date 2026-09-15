import { useCallback, useRef, type PointerEvent } from "react";

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  readout: string;
  size?: "lg" | "sm";
  disabled?: boolean;
  ticks?: boolean[];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function angleFor(value: number, min: number, max: number) {
  const t = max === min ? 0 : (value - min) / (max - min);
  return -120 + t * 240;
}

function pointerAngle(clientX: number, clientY: number, rect: DOMRect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rad = Math.atan2(clientX - cx, cy - clientY);
  return (rad * 180) / Math.PI;
}

export function Knob({
  value,
  min,
  max,
  onChange,
  label,
  readout,
  size = "lg",
  disabled,
  ticks,
}: KnobProps) {
  const discRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef(value);
  lastValue.current = value;

  const applyAngle = useCallback(
    (deg: number) => {
      const clamped = clamp(deg, -120, 120);
      const t = (clamped + 120) / 240;
      const next = Math.round(min + t * (max - min));
      if (next !== lastValue.current) onChange(clamp(next, min, max));
    },
    [max, min, onChange],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = discRef.current?.getBoundingClientRect();
    if (rect) applyAngle(pointerAngle(event.clientX, event.clientY, rect));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = discRef.current?.getBoundingClientRect();
    if (rect) applyAngle(pointerAngle(event.clientX, event.clientY, rect));
  };

  const nudge = (delta: number) => {
    if (disabled) return;
    onChange(clamp(value + delta, min, max));
  };

  const rot = angleFor(value, min, max);
  const steps = max - min + 1;

  return (
    <div className={`knob-wrap ${size === "sm" ? "knob-wrap-sm" : ""}`}>
      <span className="engraved">{label}</span>
      <div
        ref={discRef}
        className={`knob ${size === "sm" ? "knob-sm" : ""} ${disabled ? "is-disabled" : ""}`}
        style={{ ["--knob-rot" as string]: `${rot}deg` }}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={readout}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            nudge(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            nudge(-1);
          }
        }}
      >
        <div className="knob-skirt" aria-hidden="true">
          {Array.from({ length: steps }, (_, i) => {
            const a = angleFor(min + i, min, max);
            const live = ticks?.[i];
            const rad = (a * Math.PI) / 180;
            return (
              <span
                key={i}
                className={`knob-tick ${live ? "is-live" : ""}`}
                style={{
                  left: `${50 + 46 * Math.sin(rad)}%`,
                  top: `${50 - 46 * Math.cos(rad)}%`,
                  transform: `translate(-50%, -50%) rotate(${a}deg)`,
                }}
              />
            );
          })}
        </div>
        <div className="knob-disc" aria-hidden="true">
          <span className="knob-pointer" />
          <span className="knob-cap" />
        </div>
      </div>
      <span className="knob-readout">{readout}</span>
    </div>
  );
}
