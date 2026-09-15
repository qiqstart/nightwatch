import { CODE_CARD } from "@/lib/morse/alphabet";

interface CodeCardProps {
  open: boolean;
  onClose: () => void;
}

export function CodeCard({ open, onClose }: CodeCardProps) {
  return (
    <div
      className={`code-card ${open ? "is-open" : ""}`}
      aria-hidden={!open}
      inert={!open || undefined}
    >
      <div className="code-card-head">
        <span className="engraved">MORSE CARD</span>
        <button type="button" className="plate-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>
      <ol className="code-grid">
        {CODE_CARD.map((row) => (
          <li key={row.ch}>
            <span>{row.ch}</span>
            <span>{row.code}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
