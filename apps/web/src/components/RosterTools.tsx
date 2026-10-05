"use client";

import { localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { classColor, classText } from "@/lib/game";
import type { GameVersion, MeResponse, ViewerRole } from "@/lib/types";

type Profile = GameVersion;

interface Props {
  guildId: string;
  region: string;
  profile: Profile;
  viewerRole: ViewerRole;
  /** The viewer's characters (same region) that are not in the roster yet. */
  myCharacters: NonNullable<MeResponse["characters"]>;
}

/** Ways to add people to a roster: planned characters, the viewer's own characters, any game character. */
export function RosterTools({ guildId, region, profile, viewerRole, myCharacters }: Props) {
  const t = useTranslations("roster");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isOfficer = viewerRole === "OWNER" || viewerRole === "OFFICER";
  if (!viewerRole) return null;

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: success });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error") });
      return false;
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <PlannedForm guildId={guildId} profile={profile} isOfficer={isOfficer} run={run} />
        {profile.apiAvailable ? (
          <div className="space-y-4">
            {myCharacters.length > 0 && <MyCharactersForm guildId={guildId} profile={profile} characters={myCharacters} run={run} />}
            {isOfficer && <RealCharacterForm guildId={guildId} hasRealms={profile.hasRealms} region={region} run={run} />}
          </div>
        ) : (
          // Versions without a Blizzard API (Forever, for now) only hold planned characters.
          <p className="card text-sm text-muted">{t("noApiYet")}</p>
        )}
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

type Run = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

function PlannedForm({ guildId, profile, isOfficer, run }: { guildId: string; profile: Profile; isOfficer: boolean; run: Run }) {
  const t = useTranslations("roster");
  const locale = useLocale();
  const [classId, setClassId] = useState(profile.classes[0]?.id ?? 0);
  const [pending, setPending] = useState(false);
  const specs = profile.classes.find((c) => c.id === classId)?.specs ?? [];

  return (
    <form
      className="card space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        const ok = await run(
          () =>
            apiSend("POST", `/guilds/${guildId}/roster/planned`, {
              classId,
              specKey: data.get("specKey") || null,
              role: data.get("role") || null,
              plannedName: data.get("plannedName") || null,
              playerName: data.get("playerName") || null,
              note: data.get("note") || null,
              forSelf: data.get("forSelf") === "on",
            }),
          t("plannedAdded"),
        );
        setPending(false);
        if (ok) form.reset();
      }}
    >
      <div>
        <h3 className="heading">{t("planTitle")}</h3>
        <p className="text-xs text-muted">{t("planHelp")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="plan-class">{t("class")}</label>
          <select
            id="plan-class"
            className="input text-class"
            value={classId}
            onChange={(e) => setClassId(Number(e.target.value))}
            style={classText(classColor(profile, classId))}
          >
            {profile.classes.map((c) => (
              <option key={c.id} value={c.id}>{localize(c.name, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plan-spec">{t("spec")}</label>
          <select id="plan-spec" name="specKey" className="input" key={classId} defaultValue="">
            <option value="">{t("anySpec")}</option>
            {specs.map((s) => (
              <option key={s.key} value={s.key}>{localize(s.name, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="plan-role">{t("role")}</label>
          <select id="plan-role" name="role" className="input" defaultValue="">
            <option value="">{t("roleFromSpec")}</option>
            {profile.roles.map((r) => (
              <option key={r.key} value={r.key}>{localize(r.name, locale)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="plan-name">{t("plannedName")}</label>
          <input id="plan-name" name="plannedName" maxLength={40} className="input" placeholder={t("plannedNamePlaceholder")} />
        </div>
        {isOfficer && (
          <div>
            <label className="label" htmlFor="plan-player">{t("playerName")}</label>
            <input id="plan-player" name="playerName" maxLength={40} className="input" />
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor="plan-note">{t("note")}</label>
        <input id="plan-note" name="note" maxLength={500} className="input" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isOfficer ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="forSelf" />
            {t("forMe")}
          </label>
        ) : (
          <span className="text-xs text-muted">{t("plannedForYou")}</span>
        )}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t("adding") : t("planSubmit")}
        </button>
      </div>
    </form>
  );
}

function MyCharactersForm({
  guildId,
  profile,
  characters,
  run,
}: {
  guildId: string;
  profile: Profile;
  characters: NonNullable<MeResponse["characters"]>;
  run: Run;
}) {
  const t = useTranslations("roster");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

  return (
    <form
      className="card space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (selected.size === 0) return;
        setPending(true);
        const ok = await run(() => apiSend("POST", `/guilds/${guildId}/roster/mine`, { characterIds: [...selected] }), t("myAdded"));
        setPending(false);
        if (ok) setSelected(new Set());
      }}
    >
      <h3 className="heading">{t("myTitle")}</h3>
      <ul className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
        {characters.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-white/5">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  })
                }
              />
              <span className="text-class" style={classText(classColor(profile, c.classId))}>{c.name}</span>
              <span className="text-xs text-muted">{c.level}</span>
            </label>
          </li>
        ))}
      </ul>
      <button type="submit" className="btn btn-primary" disabled={pending || selected.size === 0}>
        {pending ? t("adding") : t("myAdd", { count: selected.size })}
      </button>
    </form>
  );
}

function RealCharacterForm({ guildId, hasRealms, region, run }: { guildId: string; hasRealms: boolean; region: string; run: Run }) {
  const t = useTranslations("roster");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="card space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        const ok = await run(() => apiSend("POST", `/guilds/${guildId}/roster`, { realm: data.get("realm"), name: data.get("name") }), t("realAdded"));
        setPending(false);
        if (ok) form.reset();
      }}
    >
      <h3 className="heading">{t("addTitle")}</h3>
      <p className="text-xs text-muted">{t("addHelp", { region: region.toUpperCase() })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="add-realm">{hasRealms ? t("realm") : t("ruleset")}</label>
          <input id="add-realm" name="realm" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="add-name">{t("name")}</label>
          <input id="add-name" name="name" required className="input" />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? t("adding") : t("add")}
      </button>
    </form>
  );
}
