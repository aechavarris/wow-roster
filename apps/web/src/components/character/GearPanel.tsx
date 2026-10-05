import type { EquippedItem } from "@wow/blizzard";
import { useTranslations } from "next-intl";
import { QUALITY_COLORS, wowheadUrl } from "@/lib/game";
import { Unavailable } from "./Unavailable";

/** In-game paper doll order: left column, right column, weapons. */
const LAYOUT = [
  ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"],
  ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"],
  ["MAIN_HAND", "OFF_HAND", "RANGED"],
];

function wowheadData(item: EquippedItem) {
  const params = new URLSearchParams();
  const permanent = item.enchantments.find((e) => e.slot === "PERMANENT" || !e.slot);
  if (permanent?.id) params.set("ench", String(permanent.id));
  const gems = item.gems.flatMap((g) => (g.itemId ? [g.itemId] : []));
  if (gems.length) params.set("gems", gems.join(":"));
  if (item.bonusIds.length) params.set("bonus", item.bonusIds.join(":"));
  if (item.itemLevel) params.set("ilvl", String(item.itemLevel));
  return params.toString();
}

export function GearPanel({ items, missing, wowheadDomain }: { items?: EquippedItem[]; missing?: string; wowheadDomain: string }) {
  const t = useTranslations("character");
  const tSlots = useTranslations("slots");
  const bySlot = new Map((items ?? []).map((i) => [i.slot, i]));
  // Slots the profile layout does not know about are still listed at the end.
  const extra = (items ?? []).filter((i) => !LAYOUT.flat().includes(i.slot));

  const renderSlot = (slot: string, item: EquippedItem | undefined) => (
    <li key={slot} className="flex min-h-12 items-start gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-muted">{tSlots.has(slot) ? tSlots(slot) : (item?.slotName ?? slot)}</p>
        {item ? (
          <>
            <a
              href={wowheadUrl(wowheadDomain, "item", item.itemId)}
              data-wowhead={wowheadData(item)}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium"
              style={{ color: QUALITY_COLORS[item.quality ?? ""] ?? "inherit" }}
            >
              {item.name}
            </a>
            {item.enchantments.map((e, i) => (
              <p key={i} className="truncate text-xs text-success">{e.text}</p>
            ))}
            {item.gems.map((g, i) => (
              <p key={i} className="truncate text-xs text-muted">◆ {g.text ?? g.itemId}</p>
            ))}
          </>
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </div>
      {item?.itemLevel != null && <span className="text-xs tabular-nums text-muted">{item.itemLevel}</span>}
    </li>
  );

  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("gear")}</h2>
      {!items ? (
        <Unavailable reason={missing} />
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {LAYOUT.slice(0, 2).map((column, i) => (
              <ul key={i} className="space-y-2">
                {column.map((slot) => renderSlot(slot, bySlot.get(slot)))}
              </ul>
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {LAYOUT[2]!.filter((slot) => bySlot.has(slot) || slot !== "RANGED").map((slot) => renderSlot(slot, bySlot.get(slot)))}
            {extra.map((item) => renderSlot(item.slot, item))}
          </ul>
        </div>
      )}
    </section>
  );
}
