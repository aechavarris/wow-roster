"use client";

import { localize } from "@wow/config";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { characterPath, classColor, className, roleOf, specName, statusOf } from "@/lib/game";
import type { PublicConfig, RosterCharacter, RosterPlayer } from "@/lib/types";

type Profile = PublicConfig["profile"];
type SortKey = "name" | "class" | "role" | "status" | "itemLevel" | "level" | "rank";

interface Props {
  guildId: string;
  players: RosterPlayer[];
  profile: Profile;
  canEdit: boolean;
  hasRealms: boolean;
}

const AUTO = "__auto__";

export function RosterTable({ guildId, players, profile, canEdit, hasRealms }: Props) {
  const t = useTranslations("roster");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();

  const visibleStatuses = profile.rosterStatuses.filter((s) => !s.hidden).map((s) => s.key);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set(visibleStatuses));
  const [role, setRole] = useState("");
  const [classId, setClassId] = useState("");
  const [showAlts, setShowAlts] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (c: RosterCharacter) =>
      statuses.has(c.status) &&
      (!role || c.role === role) &&
      (!classId || String(c.classId) === classId) &&
      (!term || c.name.toLowerCase().includes(term));
    const value = (c: RosterCharacter): string | number => {
      switch (sort.key) {
        case "class": return className(profile, c.classId, locale);
        case "role": return c.role ?? "";
        case "status": return profile.rosterStatuses.findIndex((s) => s.key === c.status);
        case "itemLevel": return c.itemLevel ?? 0;
        case "level": return c.level;
        case "rank": return c.guildRank ?? 99;
        default: return c.name.toLowerCase();
      }
    };
    return players
      .filter((p) => matches(p.main) || (showAlts && p.alts.some(matches)))
      .sort((a, b) => {
        const va = value(a.main);
        const vb = value(b.main);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
      });
  }, [players, search, statuses, role, classId, showAlts, sort, profile, locale]);

  // Composition summary counts only players whose main is in a raiding status.
  const summary = useMemo(() => {
    const raiding = new Set(profile.rosterStatuses.filter((s) => s.raiding).map((s) => s.key));
    const mains = players.map((p) => p.main).filter((c) => raiding.has(c.status));
    const byRole = new Map<string, number>();
    const byClass = new Map<number, number>();
    for (const c of mains) {
      if (c.role) byRole.set(c.role, (byRole.get(c.role) ?? 0) + 1);
      if (c.classId != null) byClass.set(c.classId, (byClass.get(c.classId) ?? 0) + 1);
    }
    return { total: mains.length, byRole, byClass };
  }, [players, profile]);

  const mainOptions = useMemo(
    () => players.filter((p) => !p.claimed).map((p) => p.main).sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );

  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    }
  }

  const updateEntry = (entryId: string, body: Record<string, unknown>) =>
    mutate(() => apiSend("PATCH", `/guilds/${guildId}/roster/${entryId}`, body));

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }));

  const header = (key: SortKey, label: string, className = "") => (
    <th className={`px-2 py-2 font-medium ${className}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(key)} className="hover:text-accent">
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="font-medium">{t("raiders", { count: summary.total })}</span>
        {profile.roles.map((r) => (
          <span key={r.key} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
            {localize(r.name, locale)}: <strong>{summary.byRole.get(r.key) ?? 0}</strong>
          </span>
        ))}
        <span className="flex flex-wrap gap-2">
          {profile.classes
            .filter((c) => summary.byClass.has(c.id))
            .map((c) => (
              <span key={c.id} className="badge bg-surface-2" style={{ color: c.color }}>
                {localize(c.name, locale)} {summary.byClass.get(c.id)}
              </span>
            ))}
        </span>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="roster-search">{t("search")}</label>
          <input id="roster-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="roster-role">{t("role")}</label>
          <select id="roster-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t("all")}</option>
            {profile.roles.map((r) => (
              <option key={r.key} value={r.key}>{localize(r.name, locale)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="roster-class">{t("class")}</label>
          <select id="roster-class" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">{t("all")}</option>
            {profile.classes.map((c) => (
              <option key={c.id} value={c.id}>{localize(c.name, locale)}</option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap gap-1">
          <legend className="label">{t("status")}</legend>
          {profile.rosterStatuses.map((s) => {
            const active = statuses.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setStatuses((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className={`badge border ${active ? "border-transparent" : "border-border opacity-50"}`}
                style={active ? { background: s.color, color: "#111" } : undefined}
              >
                {localize(s.name, locale)}
              </button>
            );
          })}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAlts} onChange={(e) => setShowAlts(e.target.checked)} />
          {t("showAlts")}
        </label>
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {header("name", t("columns.name"))}
              {header("class", t("columns.class"))}
              {header("role", t("columns.role"))}
              {header("status", t("columns.status"))}
              {header("itemLevel", t("columns.itemLevel"), "text-right")}
              {header("level", t("columns.level"), "text-right")}
              {header("rank", t("columns.rank"), "text-right")}
              <th className="px-2 py-2 font-medium">{t("columns.updated")}</th>
              {canEdit && <th className="px-2 py-2 font-medium">{t("columns.actions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="px-2 py-6 text-center text-muted">{t("empty")}</td>
              </tr>
            )}
            {filtered.map((player) => (
              <Fragment key={player.key}>
                <Row
                  character={player.main}
                  altCount={player.alts.length}
                  profile={profile}
                  canEdit={canEdit}
                  mainOptions={player.claimed ? [] : mainOptions.filter((m) => m.entryId !== player.main.entryId)}
                  onUpdate={updateEntry}
                  onRemove={(entryId) => mutate(() => apiSend("DELETE", `/guilds/${guildId}/roster/${entryId}`))}
                />
                {showAlts &&
                  player.alts.map((alt) => (
                    <Row
                      key={alt.entryId}
                      character={alt}
                      isAlt
                      profile={profile}
                      canEdit={canEdit}
                      mainOptions={player.claimed ? [] : mainOptions.filter((m) => m.entryId !== alt.entryId)}
                      onUpdate={updateEntry}
                      onRemove={(entryId) => mutate(() => apiSend("DELETE", `/guilds/${guildId}/roster/${entryId}`))}
                    />
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && <AddCharacterForm guildId={guildId} hasRealms={hasRealms} onDone={mutate} />}
    </div>
  );
}

interface RowProps {
  character: RosterCharacter;
  profile: Profile;
  canEdit: boolean;
  isAlt?: boolean;
  altCount?: number;
  mainOptions: RosterCharacter[];
  onUpdate: (entryId: string, body: Record<string, unknown>) => void;
  onRemove: (entryId: string) => void;
}

function Row({ character: c, profile, canEdit, isAlt, altCount = 0, mainOptions, onUpdate, onRemove }: RowProps) {
  const t = useTranslations("roster");
  const locale = useLocale();
  const format = useFormatter();
  const role = roleOf(profile, c.role);
  const status = statusOf(profile, c.status);

  return (
    <tr className={isAlt ? "bg-surface-2/50 text-xs" : ""}>
      <td className="px-2 py-1.5">
        <div className={`flex items-center gap-2 ${isAlt ? "pl-6" : ""}`}>
          {c.avatar && !isAlt ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blizzard renders are already sized thumbnails.
            <img src={c.avatar} alt="" width={24} height={24} className="rounded" />
          ) : null}
          <Link href={characterPath(c)} className="font-medium hover:underline" style={{ color: classColor(profile, c.classId) }}>
            {c.name}
          </Link>
          {c.claimed && <span title={t("claimed")} className="text-accent">✓</span>}
          {altCount > 0 && <span className="text-xs text-muted">+{altCount}</span>}
          {c.source === "manual" && <span className="badge bg-surface-2 text-muted">{t("manual")}</span>}
          {c.note && <span title={c.note} className="cursor-help text-muted">✎</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-muted">
        {specName(profile, c.classId, c.specKey, locale)} {className(profile, c.classId, locale)}
      </td>
      <td className="px-2 py-1.5">
        {canEdit ? (
          <select
            aria-label={t("columns.role")}
            className="input w-auto py-0.5"
            value={c.roleOverridden ? (c.role ?? AUTO) : AUTO}
            onChange={(e) => onUpdate(c.entryId, { role: e.target.value === AUTO ? null : e.target.value })}
          >
            <option value={AUTO}>{t("auto", { value: role ? localize(role.name, locale) : "—" })}</option>
            {profile.roles.map((r) => (
              <option key={r.key} value={r.key}>{localize(r.name, locale)}</option>
            ))}
          </select>
        ) : role ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: role.color }} />
            {localize(role.name, locale)}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-1.5">
        {canEdit ? (
          <select
            aria-label={t("columns.status")}
            className="input w-auto py-0.5"
            value={c.statusOverridden ? c.status : AUTO}
            onChange={(e) => onUpdate(c.entryId, { status: e.target.value === AUTO ? null : e.target.value })}
          >
            <option value={AUTO}>{t("byRank", { value: status ? localize(status.name, locale) : c.status })}</option>
            {profile.rosterStatuses.map((s) => (
              <option key={s.key} value={s.key}>{localize(s.name, locale)}</option>
            ))}
          </select>
        ) : (
          <span className="badge" style={{ background: status?.color, color: "#111" }}>
            {status ? localize(status.name, locale) : c.status}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">{c.itemLevel ? Math.round(c.itemLevel) : "—"}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{c.level}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{c.guildRank ?? "—"}</td>
      <td className="px-2 py-1.5 text-xs text-muted">
        {c.syncError ? (
          <span className="text-danger">{t("syncError")}</span>
        ) : c.lastSyncedAt ? (
          format.relativeTime(new Date(c.lastSyncedAt))
        ) : (
          t("pending")
        )}
      </td>
      {canEdit && (
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            {mainOptions.length > 0 && !c.claimed && (
              <select
                aria-label={t("linkMain")}
                className="input w-32 py-0.5"
                value=""
                onChange={(e) => onUpdate(c.entryId, { mainEntryId: e.target.value === AUTO ? null : e.target.value })}
              >
                <option value="">{t("linkMain")}</option>
                {isAlt && <option value={AUTO}>{t("unlink")}</option>}
                {mainOptions.map((m) => (
                  <option key={m.entryId} value={m.entryId}>{m.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="btn px-2 py-0.5"
              title={t("editNote")}
              onClick={() => {
                const note = window.prompt(t("editNote"), c.note ?? "");
                if (note !== null) onUpdate(c.entryId, { note: note.trim() || null });
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="btn px-2 py-0.5"
              title={c.source === "manual" ? t("remove") : t("hide")}
              onClick={() => {
                if (window.confirm(c.source === "manual" ? t("confirmRemove", { name: c.name }) : t("confirmHide", { name: c.name }))) {
                  onRemove(c.entryId);
                }
              }}
            >
              ✕
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function AddCharacterForm({
  guildId,
  hasRealms,
  onDone,
}: {
  guildId: string;
  hasRealms: boolean;
  onDone: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations("roster");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="card flex flex-wrap items-end gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setPending(true);
        await onDone(() => apiSend("POST", `/guilds/${guildId}/roster`, { realm: data.get("realm"), name: data.get("name") }));
        setPending(false);
        form.reset();
      }}
    >
      <h3 className="heading w-full">{t("addTitle")}</h3>
      <div>
        <label className="label" htmlFor="add-realm">{hasRealms ? t("realm") : t("ruleset")}</label>
        <input id="add-realm" name="realm" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="add-name">{t("name")}</label>
        <input id="add-name" name="name" required className="input" />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? t("adding") : t("add")}
      </button>
    </form>
  );
}
