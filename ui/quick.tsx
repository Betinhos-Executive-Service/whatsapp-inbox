import type { QuickReply } from "./api.ts";

export { fillQuickReply, quickQuery } from "./quick-text.ts";

export function QuickReplyMenu({ items, active, onPick, onHover }: {
  items: QuickReply[];
  active: number;
  onPick: (q: QuickReply) => void;
  onHover: (i: number) => void;
}) {
  return (
    <ul className="quick-menu" role="listbox" id="quick-menu" aria-label="Respostas rápidas">
      {items.map((q, i) => (
        <li
          key={q.shortcut}
          id={`quick-${q.shortcut}`}
          role="option"
          aria-selected={i === active}
          className="quick-menu__item"
          // mousedown para não tirar o foco do campo antes de escolher
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(q);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="quick-menu__shortcut">/{q.shortcut}</span>
          <span className="quick-menu__text">{q.text}</span>
        </li>
      ))}
    </ul>
  );
}
