"use client";

import type { SelectedTalentNode, TalentNode, TalentOption } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import { tr } from "@/lib/text";
import { GameTooltip } from "../ui/GameTooltip";

/** Client units between neighbouring nodes in Blizzard's raw positions. */
const UNIT = 600;
const STEP = 46;
const NODE = 36;

const OCTAGON = "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)";

interface Props {
  title: string;
  nodes: TalentNode[];
  selected: Map<number, SelectedTalentNode>;
}

/** Draws one talent tree (class, spec or hero) with the game's positions and connections. */
export function TalentTreeCanvas({ title, nodes, selected }: Props) {
  const t = useTranslations("character");
  if (nodes.length === 0) return null;

  const hasRaw = nodes.every((n) => n.x !== undefined && n.y !== undefined);
  const xOf = (n: TalentNode) => (hasRaw ? n.x! / UNIT : n.col);
  const yOf = (n: TalentNode) => (hasRaw ? n.y! / UNIT : n.row);
  const minX = Math.min(...nodes.map(xOf));
  const minY = Math.min(...nodes.map(yOf));
  const pos = (n: TalentNode) => ({ left: (xOf(n) - minX) * STEP, top: (yOf(n) - minY) * STEP });
  const width = Math.max(...nodes.map((n) => pos(n).left)) + NODE;
  const height = Math.max(...nodes.map((n) => pos(n).top)) + NODE;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const spent = nodes.reduce((sum, n) => {
    const pick = selected.get(n.id);
    return sum + (pick ? Math.max(0, pick.rank - (pick.defaultPoints ?? 0)) : 0);
  }, 0);

  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
        <span>{title}</span>
        <span className="text-xs text-muted tabular-nums">{t("pointsSpent", { count: spent })}</span>
      </h3>
      <div className="overflow-x-auto pb-2">
        <div className="relative mx-auto" style={{ width, height }}>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
            {nodes.flatMap((node) =>
              node.lockedBy.map((parentId) => {
                const parent = byId.get(parentId);
                if (!parent) return null;
                const a = pos(parent);
                const b = pos(node);
                const lit = selected.has(node.id) && selected.has(parentId);
                return (
                  <line
                    key={`${parentId}-${node.id}`}
                    x1={a.left + NODE / 2}
                    y1={a.top + NODE / 2}
                    x2={b.left + NODE / 2}
                    y2={b.top + NODE / 2}
                    stroke={lit ? "#e6b422" : "#4a4f5c"}
                    strokeWidth={lit ? 3 : 2}
                    strokeOpacity={lit ? 0.9 : 0.6}
                  />
                );
              }),
            )}
          </svg>
          {nodes.map((node) => (
            <TalentNodeButton key={node.id} node={node} pick={selected.get(node.id)} style={pos(node)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TalentNodeButton({
  node,
  pick,
  style,
}: {
  node: TalentNode;
  pick?: SelectedTalentNode;
  style: { left: number; top: number };
}) {
  const locale = useLocale();
  const chosen = pick && node.options.length > 1 ? node.options.find((o) => o.talentId === pick.talentId) : undefined;
  const shown = chosen ? [chosen] : node.options;
  const active = Boolean(pick);
  const complete = pick && pick.rank >= node.maxRank;
  const border = !active ? "#3a3f4b" : complete ? "#e6b422" : "#1eff00";
  const shape = node.type === "CHOICE" ? { clipPath: OCTAGON } : undefined;
  const radius = node.type === "PASSIVE" ? "9999px" : node.type === "CHOICE" ? "0" : "6px";
  const name = node.options.map((o) => tr(o.name, locale)).join(" / ") || String(node.id);

  return (
    <GameTooltip
      label={name}
      content={<TalentTooltip node={node} pick={pick} chosen={chosen} />}
      className="absolute rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ ...style, width: NODE, height: NODE }}
    >
      <span className="relative block h-full w-full">
        <span
          className="flex h-full w-full overflow-hidden"
          style={{ ...shape, borderRadius: radius, background: border, padding: 2 }}
        >
          <span className="flex h-full w-full overflow-hidden bg-[#0b0d12]" style={{ ...shape, borderRadius: radius }}>
            {shown.map((option, i) =>
              option.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
                <img
                  key={i}
                  src={option.icon}
                  alt=""
                  className="h-full min-w-0 flex-1 object-cover"
                  style={{ filter: active ? undefined : "grayscale(1) brightness(0.55)" }}
                />
              ) : (
                <span key={i} className="h-full flex-1 bg-[#20242d]" />
              ),
            )}
          </span>
        </span>
        {node.maxRank > 1 && (
          <span
            className="absolute -bottom-1.5 -right-1.5 rounded bg-black/90 px-1 text-[10px] font-semibold leading-tight tabular-nums"
            style={{ color: active ? border : "#9d9d9d" }}
          >
            {pick?.rank ?? 0}/{node.maxRank}
          </span>
        )}
      </span>
    </GameTooltip>
  );
}

function TalentTooltip({ node, pick, chosen }: { node: TalentNode; pick?: SelectedTalentNode; chosen?: TalentOption }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const rank = pick?.rank ?? 0;
  const options = node.options.length > 1 ? node.options : node.options.slice(0, 1);

  return (
    <div className="space-y-2">
      {node.options.length > 1 && <p className="tt-grey text-xs">{t("choiceNode")}</p>}
      {options.map((option, i) => {
        const isChosen = node.options.length > 1 ? option === chosen : Boolean(pick);
        // Show the description of the current rank (or the first rank when not learned).
        const description = option.descriptions[Math.max(0, Math.min(rank, option.descriptions.length) - 1)];
        return (
          <div key={i} className={node.options.length > 1 && !isChosen ? "opacity-60" : ""}>
            <p className="tt-row font-semibold">
              <span>{tr(option.name, locale)}</span>
              {node.options.length > 1 && isChosen && <span className="tt-green text-xs">{t("chosen")}</span>}
            </p>
            {node.options.length === 1 && (
              <p className={pick ? "tt-green" : "tt-grey"}>{t("rankOf", { rank, max: node.maxRank })}</p>
            )}
            {(option.cost || option.range) && (
              <p className="tt-row">
                <span>{tr(option.cost, locale)}</span>
                <span>{tr(option.range, locale)}</span>
              </p>
            )}
            {(option.castTime || option.cooldown) && (
              <p className="tt-row">
                <span>{tr(option.castTime, locale)}</span>
                <span>{tr(option.cooldown, locale)}</span>
              </p>
            )}
            {description && <p className="tt-yellow">{tr(description, locale)}</p>}
          </div>
        );
      })}
    </div>
  );
}
