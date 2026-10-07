"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { characterPath, classColor, classText } from "@/lib/game";
import type { GameVersion, RosterCharacter } from "@/lib/types";

/**
 * Tables of roster characters that never scroll sideways: each keeps a few columns (fewer on narrow screens) and
 * clicking a character opens a panel underneath with everything else. Shared by the details and weekly pages.
 */
export interface CharacterRow {
  character: RosterCharacter;
  alt: boolean;
}

/** Which characters have their detail panel open; shared by every tab so a character stays open while switching. */
const ExpandContext = createContext<{ open: Set<string>; toggle: (id: string) => void }>({ open: new Set(), toggle: () => {} });

/** Open/closed state for every character row, plus the "expand all" toggle state. */
export function useExpandedRows(rows: CharacterRow[]) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const value = useMemo(
    () => ({
      open,
      toggle: (id: string) =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [open],
  );
  const allOpen = rows.length > 0 && rows.every((r) => open.has(r.character.entryId));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.character.entryId)));
  return { value, allOpen, toggleAll };
}

export const ExpandProvider = ExpandContext.Provider;

/** "Expand all" / "Collapse all" button for a table of character rows. */
export function ExpandAllButton({ allOpen, onClick }: { allOpen: boolean; onClick: () => void }) {
  const t = useTranslations("details");
  return (
    <button type="button" className="btn" onClick={onClick}>
      {t(allOpen ? "collapseAll" : "expandAll")}
    </button>
  );
}

export function Table({ head, children, footer }: { head: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {footer && <div className="border-t border-border px-3 py-2 text-xs text-muted">{footer}</div>}
    </>
  );
}

export const Th = ({ children, className = "" }: { children?: ReactNode; className?: string }) => (
  <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>
);
export const Td = ({ children, className = "", title, colSpan }: { children?: ReactNode; className?: string; title?: string; colSpan?: number }) => (
  <td className={`px-3 py-1.5 align-top ${className}`} title={title} colSpan={colSpan}>
    {children}
  </td>
);

/** Columns hidden on narrow screens; their data is always in the character's detail panel too. */
export const SM = "hidden sm:table-cell";
export const MD = "hidden md:table-cell";
export const LG = "hidden lg:table-cell";

/**
 * A character row that opens a detail panel underneath when clicked (anywhere but its links and controls), so
 * everything a narrow table leaves out is one click away instead of behind a horizontal scrollbar.
 */
export function DetailRow({ version, row, span, cells, detail }: { version: GameVersion; row: CharacterRow; span: number; cells: ReactNode; detail: ReactNode }) {
  const { open, toggle } = useContext(ExpandContext);
  const id = row.character.entryId;
  const isOpen = open.has(id);
  return (
    <>
      <tr
        className="cursor-pointer"
        onClick={(e) => {
          if ((e.target as Element).closest("a, button, select, input")) return;
          toggle(id);
        }}
      >
        <NameCell version={version} row={row} expanded={isOpen} onToggle={() => toggle(id)} />
        {cells}
      </tr>
      {isOpen && (
        <tr className="bg-surface-2/50 hover:bg-surface-2/50">
          <td colSpan={span} className="px-3 py-3">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}

/** Label/value pairs in a wrapping grid, for detail panels. */
export function Facts({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small cards in a wrapping grid, for detail panels with one entry per item, dungeon or instance. */
export const CardGrid = ({ children }: { children: ReactNode }) => <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
export const Card = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
    <div className="truncate font-medium">{title}</div>
    {children && <div className="text-xs text-muted">{children}</div>}
  </div>
);

/** First column: the character, linked to its sheet, with the arrow that opens its detail panel. */
function NameCell({ version, row, expanded, onToggle }: { version: GameVersion; row: CharacterRow; expanded: boolean; onToggle: () => void }) {
  const t = useTranslations("details");
  const c = row.character;
  const name = (
    <span className="text-class font-medium" style={classText(classColor(version, c.classId))}>
      {c.name}
    </span>
  );
  return (
    <td className="px-3 py-1.5 align-top">
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={t(expanded ? "collapse" : "expand", { name: c.name })}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted transition hover:bg-white/10 hover:text-accent"
        >
          <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>▸</span>
        </button>
        {row.alt && <span className="text-muted">↳</span>}
        {c.gameVersion && c.region && c.realm ? (
          <Link href={characterPath({ gameVersion: c.gameVersion, region: c.region, realm: c.realm, name: c.name })} className="hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
      </span>
    </td>
  );
}

