"use client";

import type { CharacterMedia, EquippedItem } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import { GAME_QUALITY_COLORS } from "@/lib/game";
import { tr } from "@/lib/text";
import { GameTooltip } from "../ui/GameTooltip";
import { ItemTooltip } from "./ItemTooltip";
import { Unavailable } from "./Unavailable";

/** In-game paper doll: left column, right column, weapons under the model. */
const LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const WEAPONS = ["MAIN_HAND", "OFF_HAND", "RANGED"];

interface Props {
  items?: EquippedItem[];
  missing?: string;
  media?: CharacterMedia;
  classColor: string;
}

export function GearPanel({ items, missing, media, classColor }: Props) {
  const t = useTranslations("character");
  const bySlot = new Map((items ?? []).map((i) => [i.slot, i]));
  const known = new Set([...LEFT, ...RIGHT, ...WEAPONS]);
  const extra = (items ?? []).filter((i) => !known.has(i.slot));
  const weapons = WEAPONS.filter((slot) => slot !== "RANGED" || bySlot.has(slot));
  const render = media?.main ?? media?.inset;

  return (
    <section className="card overflow-hidden p-0">
      <h2 className="heading px-4 pt-4 text-lg">{t("gear")}</h2>
      {!items ? (
        <div className="p-4">
          <Unavailable reason={missing} />
        </div>
      ) : (
        <div
          className="relative grid gap-x-2 gap-y-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,340px)_minmax(0,1fr)]"
          style={{ background: `radial-gradient(ellipse at 50% 40%, ${classColor}33, transparent 65%)` }}
        >
          {/* Blizzard's render has wide transparent margins, so it is scaled up inside a clipped frame. */}
          <div className="relative order-1 h-[300px] overflow-hidden sm:h-[420px] lg:order-2 lg:row-span-2 lg:h-auto lg:min-h-[520px]">
            {render && (
              // eslint-disable-next-line @next/next/no-img-element -- Blizzard render, transparent PNG.
              <img
                src={render}
                alt=""
                className="absolute inset-0 h-full w-full origin-[50%_55%] scale-[1.9] object-contain drop-shadow-[0_10px_25px_rgba(0,0,0,0.6)]"
              />
            )}
          </div>
          <ul className="order-2 grid min-w-0 gap-2 lg:order-1">
            {LEFT.map((slot) => (
              <Slot key={slot} slot={slot} item={bySlot.get(slot)} />
            ))}
          </ul>
          <ul className="order-3 grid min-w-0 gap-2">
            {RIGHT.map((slot) => (
              <Slot key={slot} slot={slot} item={bySlot.get(slot)} align="right" />
            ))}
          </ul>
          <ul className="order-4 grid min-w-0 gap-2 sm:grid-cols-3 lg:col-span-3 lg:mx-auto lg:w-full lg:max-w-3xl">
            {[...weapons, ...extra.map((i) => i.slot)].map((slot) => (
              <Slot key={slot} slot={slot} item={bySlot.get(slot)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Slot({ slot, item, align = "left" }: { slot: string; item?: EquippedItem; align?: "left" | "right" }) {
  const t = useTranslations("character");
  const tSlots = useTranslations("slots");
  const locale = useLocale();
  const slotName = tSlots.has(slot) ? tSlots(slot) : slot;
  const color = item ? (GAME_QUALITY_COLORS[item.quality ?? ""] ?? "#9d9d9d") : undefined;
  const rightAligned = align === "right";

  const icon = (
    <span className="icon-frame relative block h-11 w-11 shrink-0 overflow-hidden" style={{ ["--frame" as string]: color }}>
      {item?.icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
        <img src={item.icon} alt="" width={44} height={44} className="h-full w-full" />
      ) : null}
      {item?.itemLevel != null && (
        <span className="absolute bottom-0 right-0 rounded-tl bg-black/80 px-0.5 text-[10px] font-semibold leading-tight text-white tabular-nums">
          {item.itemLevel}
        </span>
      )}
    </span>
  );

  if (!item) {
    return (
      <li className={`flex items-center gap-2 opacity-50 ${rightAligned ? "lg:flex-row-reverse lg:text-right" : ""}`}>
        {icon}
        <span className="text-xs uppercase tracking-wide text-muted">{slotName}</span>
      </li>
    );
  }

  const permanentEnchant = (item.enchantments ?? []).find((e) => e.slot !== "TEMPORARY");
  return (
    <li className="min-w-0">
      <GameTooltip
        label={`${slotName}: ${tr(item.name, locale)}`}
        content={<ItemTooltip item={item} />}
        className={`flex w-full min-w-0 items-center gap-2 rounded-md p-0.5 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${rightAligned ? "lg:flex-row-reverse lg:text-right" : ""}`}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium leading-tight" style={{ color }}>
            {tr(item.name, locale)}
          </span>
          <span className="block truncate text-xs text-muted">
            {permanentEnchant ? <span className="text-success">{tr(permanentEnchant.text, locale)}</span> : slotName}
            {(item.gems ?? []).length > 0 && <span> · {t("gems", { count: item.gems.filter((g) => g.itemId).length })}</span>}
          </span>
        </span>
      </GameTooltip>
    </li>
  );
}
