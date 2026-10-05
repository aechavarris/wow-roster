import type { EquippedItem } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import { GAME_QUALITY_COLORS } from "@/lib/game";
import { tr } from "@/lib/text";

/** Tooltip lines in the same order the game client shows them. Lists default to empty for profiles synced before they existed. */
export function ItemTooltip({ item }: { item: EquippedItem }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const set = item.set;
  const equippedSetItems = set?.items.filter((i) => i.equipped).length ?? 0;

  return (
    <div>
      <p className="text-[15px] font-semibold" style={{ color: GAME_QUALITY_COLORS[item.quality ?? ""] ?? "#fff" }}>
        {tr(item.name, locale)}
      </p>
      {item.nameDescription && <p style={{ color: item.nameDescription.color }}>{tr(item.nameDescription.text, locale)}</p>}
      {item.itemLevel != null && <p className="tt-yellow">{t("itemLevelLine", { value: item.itemLevel })}</p>}
      {item.binding && <p>{tr(item.binding, locale)}</p>}
      {item.uniqueEquipped && <p>{tr(item.uniqueEquipped, locale)}</p>}
      {(item.inventoryType || item.itemSubclass) && (
        <p className="tt-row">
          <span>{tr(item.inventoryType, locale)}</span>
          <span>{tr(item.itemSubclass, locale)}</span>
        </p>
      )}
      {item.weapon && (
        <>
          <p className="tt-row">
            <span>{tr(item.weapon.damage, locale)}</span>
            <span>{tr(item.weapon.speed, locale)}</span>
          </p>
          {item.weapon.dps && <p>{tr(item.weapon.dps, locale)}</p>}
        </>
      )}
      {item.armor && <p style={{ color: item.armor.color }}>{tr(item.armor.text, locale)}</p>}
      {(item.stats ?? []).map((s, i) => (
        <p key={i} style={{ color: s.negated ? "#808080" : s.color }}>{tr(s.text, locale)}</p>
      ))}
      {(item.enchantments ?? []).map((e, i) => (
        <p key={i} className="tt-green">{tr(e.text, locale)}</p>
      ))}
      {(item.gems ?? []).map((g, i) => (
        <p key={i} className="flex items-center gap-1">
          {g.icon ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
            <img src={g.icon} alt="" width={14} height={14} className="inline-block rounded-sm" />
          ) : (
            <span className="inline-block h-3.5 w-3.5 rounded-sm border border-[#4a5a78]" />
          )}
          <span className={g.text ? "" : "tt-grey"}>{tr(g.text, locale) || tr(g.socket, locale)}</span>
        </p>
      ))}
      {(item.spells ?? []).map((s, i) => (
        <p key={i} className="tt-green tt-gap">{tr(s.text, locale)}</p>
      ))}
      {set && (
        <div className="tt-gap">
          <p className="tt-yellow">
            {tr(set.name, locale)} ({equippedSetItems}/{set.items.length})
          </p>
          {set.items.map((i, index) => (
            <p key={index} className={`pl-3 ${i.equipped ? "text-[#ffff98]" : "tt-grey"}`}>{tr(i.name, locale)}</p>
          ))}
          {set.effects.map((e, index) => (
            <p key={index} className={`tt-gap ${e.active ? "tt-green" : "tt-grey"}`}>{tr(e.text, locale)}</p>
          ))}
        </div>
      )}
      {item.description && <p className="tt-yellow tt-gap">“{tr(item.description, locale)}”</p>}
      {item.durability && <p className="tt-gap">{tr(item.durability, locale)}</p>}
      {(item.requirements ?? []).map((r, i) => (
        <p key={i}>{tr(r, locale)}</p>
      ))}
    </div>
  );
}
