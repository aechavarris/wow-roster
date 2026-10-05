import type { Profession, ProfessionTier, Reputation } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import type { GameVersion, ManualProfession } from "@/lib/types";
import { tr } from "@/lib/text";
import { ManualProfessionsForm } from "./ManualProfessionsForm";
import { Unavailable } from "./Unavailable";

interface Props {
  game: GameVersion;
  professions?: Profession[];
  missing?: string;
  manual: ManualProfession[] | null;
  characterId: string;
  /** The viewer owns the character and may enter its professions where the API has none. */
  canEdit: boolean;
}

/**
 * Professions as the game version provides them: from the API (retail, one tier per expansion) or
 * entered by the owner from the version's catalog (Classic, whose API has no professions).
 */
export function ProfessionsPanel({ game, professions, missing, manual, characterId, canEdit }: Props) {
  const t = useTranslations("character");
  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("professions")}</h2>
      {game.apiProfessions ? (
        !professions ? (
          <Unavailable reason={missing} />
        ) : professions.length === 0 ? (
          <p className="text-sm text-muted">{t("none")}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {professions.map((p) => (
              <ApiProfessionRow key={p.id} profession={p} />
            ))}
          </ul>
        )
      ) : (
        <ManualProfessions game={game} manual={manual} characterId={characterId} canEdit={canEdit} />
      )}
    </section>
  );
}

function SkillBar({ skill, max }: { skill?: number | null; max?: number }) {
  if (skill == null || !max) return null;
  return (
    <div className="mt-1 h-1.5 rounded bg-border">
      <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.min(100, (skill / max) * 100)}%` }} />
    </div>
  );
}

function ProfessionLine({ icon, name, secondary, skill, max, sub }: {
  icon?: string;
  name: string;
  secondary: boolean;
  skill?: number | null;
  max?: number;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
        <img src={icon} alt="" width={32} height={32} className="icon-frame h-8 w-8" />
      ) : (
        <span className="icon-frame h-8 w-8" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <span className={secondary ? "text-muted" : "font-medium"}>{name}</span>
          {skill != null && (
            <span className="tabular-nums text-muted">
              {skill}/{max ?? "?"}
            </span>
          )}
        </div>
        {sub && <p className="truncate text-xs text-muted">{sub}</p>}
        <SkillBar skill={skill} max={max} />
      </div>
    </div>
  );
}

/** Headline skill is the newest expansion tier; every tier is listed underneath. */
function ApiProfessionRow({ profession: p }: { profession: Profession }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const latest = p.tiers[0];
  const tierLabel = (tier: ProfessionTier) => tr(tier.name, locale) || tr(p.name, locale);
  return (
    <li>
      <ProfessionLine
        icon={p.icon}
        name={tr(p.name, locale)}
        secondary={p.secondary}
        skill={p.skill}
        max={p.maxSkill}
        sub={p.tiers.length > 1 && latest ? tierLabel(latest) : undefined}
      />
      {p.tiers.length > 1 && (
        <details className="ml-11 mt-1">
          <summary className="cursor-pointer text-xs text-muted hover:text-accent">{t("professionTiers")}</summary>
          <ul className="mt-1 space-y-1 text-xs">
            {p.tiers.map((tier, i) => (
              <li key={tier.id ?? i}>
                <div className="flex justify-between gap-2">
                  <span className="truncate">{tierLabel(tier)}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {tier.knownRecipes ? `${t("recipes", { count: tier.knownRecipes })} · ` : ""}
                    {tier.skill ?? 0}/{tier.maxSkill ?? "?"}
                  </span>
                </div>
                <SkillBar skill={tier.skill} max={tier.maxSkill} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function ManualProfessions({ game, manual, characterId, canEdit }: Omit<Props, "professions" | "missing">) {
  const t = useTranslations("character");
  const locale = useLocale();
  const known = (manual ?? []).flatMap((m) => {
    const profession = game.professions.find((p) => p.id === m.id);
    return profession ? [{ ...m, profession }] : [];
  });
  return (
    <div className="space-y-3 text-sm">
      {known.length === 0 ? (
        <p className="text-muted">{t("professionsNotSet")}</p>
      ) : (
        <ul className="space-y-2">
          {known.map(({ profession, skill }) => (
            <li key={profession.id}>
              <ProfessionLine
                name={tr(profession.name, locale)}
                secondary={profession.kind === "secondary"}
                skill={skill}
                max={profession.maxSkill}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">{t("professionsManualHelp")}</p>
      {canEdit && <ManualProfessionsForm game={game} manual={manual ?? []} characterId={characterId} />}
    </div>
  );
}

export function ReputationsPanel({ reputations, missing }: { reputations?: Reputation[]; missing?: string }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const sorted = [...(reputations ?? [])].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || tr(a.name, locale).localeCompare(tr(b.name, locale)));
  const preview = sorted.slice(0, 8);
  const rest = sorted.slice(8);

  const row = (r: Reputation) => (
    <li key={r.factionId} className="flex justify-between gap-2">
      <span className="truncate">{tr(r.name, locale)}</span>
      <span className="shrink-0 text-muted">{tr(r.standing, locale)}</span>
    </li>
  );

  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("reputations")}</h2>
      {!reputations ? (
        <Unavailable reason={missing} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">{preview.map(row)}</ul>
          {rest.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-accent">{t("showAll", { count: sorted.length })}</summary>
              <ul className="mt-1 space-y-1">{rest.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
