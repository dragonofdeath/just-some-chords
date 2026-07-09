import type { ReactNode } from "react";

interface Props {
  title: string;
  sub?: string;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Sheet({ title, sub, label, onClose, children }: Props) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={label}>
        <div className="sheet-head">
          <span className="sheet-chord">{title}</span>
          {sub && <span className="sheet-roman">{sub}</span>}
        </div>
        {children}
      </div>
    </>
  );
}
