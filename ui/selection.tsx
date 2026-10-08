import { Copy, Forward, X } from "lucide-react";
import { Button } from "./ds/index.ts";

/** Barra do modo de seleção, no lugar do composer. Esc ou X saem. */
export function SelectionBar({ count, canForward, onCopy, onForward, onCancel }: {
  count: number;
  canForward: boolean;
  onCopy: () => void;
  onForward: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="Mensagens selecionadas">
      <Button variant="ghost" size="compact" icon={<X size={18} aria-hidden />} aria-label="Cancelar seleção" title="Cancelar (Esc)" onClick={onCancel} />
      <span className="selection-bar__count" aria-live="polite">
        {count === 0 ? "Toque nas mensagens para selecionar" : count === 1 ? "1 selecionada" : `${count} selecionadas`}
      </span>
      <Button variant="secondary" size="compact" icon={<Copy size={16} aria-hidden />} disabled={count === 0} onClick={onCopy}>
        Copiar
      </Button>
      <Button variant="primary" size="compact" icon={<Forward size={16} aria-hidden />} disabled={count === 0 || !canForward} onClick={onForward}>
        Encaminhar
      </Button>
    </div>
  );
}
