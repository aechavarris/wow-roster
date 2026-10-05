"use client";

import { localize } from "@wow/config";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { Link, useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { characterPath, classColor, classText, className, roleOf, specName, statusOf } from "@/lib/game";
import type { GameVersion, RosterCharacter, RosterPlayer, ViewerRole } from "@/lib/types";

type Profile = GameVersion;
type SortKey = "name" | "class" | "role" | "status" | "itemLevel" | "level" | "rank";

interface Props {
  guildId: string;
  players: RosterPlayer[];
  profile: Profile;
  viewerRole: ViewerRole;
  viewerUserId: string | null;
  /** Guild ranks only exist in guild-linked rosters. */
  showRank: boolean;
}

const AUTO = "__auto__";

export function RosterTable({ guildId, players, profile, viewerRole, viewerUserId, showRank }: Props) {
  const hasRealms = profile.hasRealms;
  const t = useTranslations("roster");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const isOfficer = viewerRole === "OWNER" || viewerRole === "OFFICER";

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
      (!term || c.name.toLowerCase().includes(term) || (c.playerName ?? "").toLowerCase().includes(term));
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

  const mainOptions = useMemo(
    () => players.filter((p) => !p.claimed).map((p) => p.main).sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );

  async function mutate(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
      return false;
    }
  }

  const actions: RowActions = {
    update: (entryId, body) => mutate(() => apiSend("PATCH", `/guilds/${guildId}/roster/${entryId}`, body)),
    remove: (entryId) => mutate(() => apiSend("DELETE", `/guilds/${guildId}/roster/${entryId}`)),
    link: (entryId, realm, name) => mutate(() => apiSend("POST", `/guilds/${guildId}/roster/${entryId}/link`, { realm, name })),
  };

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }));

  const header = (key: SortKey, label: string, extra = "") => (
    <th className={`px-2 py-2 font-medium ${extra}`} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => toggleSort(key)} className="uppercase tracking-wide hover:text-accent">
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  const rowProps = (c: RosterCharacter, player: RosterPlayer) => ({
    character: c,
    profile,
    hasRealms,
    showRank,
    isOfficer,
    // Members edit their own planned entries; officers edit everything.
    // Planned entries can only become real characters in versions with a Blizzard API.
    canLink: profile.apiAvailable,
    canEditPlanning: isOfficer || (c.planned && c.userId !== null && c.userId === viewerUserId),
    canRemove: isOfficer || ((c.source === "manual" || c.source === "planned") && c.userId !== null && c.userId === viewerUserId),
    mainOptions: player.claimed ? [] : mainOptions.filter((m) => m.entryId !== c.entryId),
    actions,
  });

  return (
    <div className="space-y-4">
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
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {header("name", t("columns.name"))}
              {header("class", t("columns.class"))}
              {header("role", t("columns.role"))}
              {header("status", t("columns.status"))}
              {header("itemLevel", t("columns.itemLevel"), "text-right")}
              {header("level", t("columns.level"), "text-right")}
              {showRank && header("rank", t("columns.rank"), "text-right")}
              <th className="px-2 py-2 font-medium">{t("columns.updated")}</th>
              {viewerRole && <th className="px-2 py-2 font-medium">{t("columns.actions")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={(viewerRole ? 9 : 8) - (showRank ? 0 : 1)} className="px-2 py-6 text-center text-muted">{t("empty")}</td>
              </tr>
            )}
            {filtered.map((player) => (
              <Fragment key={player.key}>
                <Row {...rowProps(player.main, player)} altCount={player.alts.length} showActions={viewerRole !== null} />
                {showAlts &&
                  player.alts.map((alt) => <Row key={alt.entryId} {...rowProps(alt, player)} isAlt showActions={viewerRole !== null} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface RowActions {
  update: (entryId: string, body: Record<string, unknown>) => Promise<boolean>;
  remove: (entryId: string) => Promise<boolean>;
  link: (entryId: string, realm: string, name: string) => Promise<boolean>;
}

interface RowProps {
  character: RosterCharacter;
  profile: Profile;
  hasRealms: boolean;
  showRank: boolean;
  canLink: boolean;
  isOfficer: boolean;
  canEditPlanning: boolean;
  canRemove: boolean;
  showActions: boolean;
  isAlt?: boolean;
  altCount?: number;
  mainOptions: RosterCharacter[];
  actions: RowActions;
}

function Row({ character: c, profile, hasRealms, showRank, canLink, isOfficer, canEditPlanning, canRemove, showActions, isAlt, altCount = 0, mainOptions, actions }: RowProps) {
  const t = useTranslations("roster");
  const locale = useLocale();
  const format = useFormatter();
  const role = roleOf(profile, c.role);
  const status = statusOf(profile, c.status);
  const gameClass = profile.classes.find((g) => g.id === c.classId);
  const color = classColor(profile, c.classId);

  return (
    <tr className={`${isAlt ? "bg-surface-2/50 text-xs" : ""} ${c.planned ? "bg-accent/5" : ""}`}>
      <td className="min-w-44 px-2 py-1.5">
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${isAlt ? "pl-6" : ""}`}>
          {c.avatar && !isAlt ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blizzard renders are already sized thumbnails.
            <img src={c.avatar} alt="" width={24} height={24} className="rounded" />
          ) : c.planned ? (
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded border border-dashed border-border text-xs text-muted">
              ?
            </span>
          ) : null}
          {c.planned || !c.gameVersion || !c.region || !c.realm ? (
            <span className="text-class font-medium italic" style={classText(color)}>{c.name}</span>
          ) : (
            <Link href={characterPath({ gameVersion: c.gameVersion, region: c.region, realm: c.realm, name: c.name })} className="text-class font-medium hover:underline" style={classText(color)}>
              {c.name}
            </Link>
          )}
          {c.claimed && <span title={t("claimed")} className="text-accent">✓</span>}
          {altCount > 0 && <span className="text-xs text-muted">+{altCount}</span>}
          {c.planned && <span className="badge border border-dashed border-accent/60 text-accent">{t("planned")}</span>}
          {c.source === "manual" && <span className="badge bg-surface-2 text-muted">{t("manual")}</span>}
          {c.playerName && c.playerName !== c.name && <span className="text-xs text-muted">· {c.playerName}</span>}
          {c.note && <span title={c.note} className="cursor-help text-muted">✎</span>}
        </div>
      </td>
      <td className="px-2 py-1.5 text-muted">
        {c.planned && canEditPlanning ? (
          <div className="flex gap-1">
            <select
              aria-label={t("columns.class")}
              className="input w-auto max-w-32 py-0.5"
              value={c.classId ?? ""}
              onChange={(e) => actions.update(c.entryId, { plannedClassId: Number(e.target.value) })}
            >
              {profile.classes.map((g) => (
                <option key={g.id} value={g.id}>{localize(g.name, locale)}</option>
              ))}
            </select>
            <select
              aria-label={t("spec")}
              className="input w-auto max-w-32 py-0.5"
              value={c.specKey ?? ""}
              onChange={(e) => actions.update(c.entryId, { plannedSpec: e.target.value || null })}
            >
              <option value="">{t("anySpec")}</option>
              {gameClass?.specs.map((s) => (
                <option key={s.key} value={s.key}>{localize(s.name, locale)}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            {specName(profile, c.classId, c.specKey, locale)} {className(profile, c.classId, locale)}
          </>
        )}
      </td>
      <td className="px-2 py-1.5">
        {isOfficer || canEditPlanning ? (
          <select
            aria-label={t("columns.role")}
            className="input w-auto max-w-40 py-0.5"
            value={c.roleOverridden ? (c.role ?? AUTO) : AUTO}
            onChange={(e) => actions.update(c.entryId, { role: e.target.value === AUTO ? null : e.target.value })}
          >
            <option value={AUTO}>{t("auto", { value: role && !c.roleOverridden ? localize(role.name, locale) : "—" })}</option>
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
        {isOfficer ? (
          <select
            aria-label={t("columns.status")}
            className="input w-auto max-w-36 py-0.5"
            value={c.statusOverridden ? c.status : AUTO}
            onChange={(e) => actions.update(c.entryId, { status: e.target.value === AUTO ? null : e.target.value })}
          >
            <option value={AUTO}>{t(c.guildRank != null ? "byRank" : "byDefault", { value: status ? localize(status.name, locale) : c.status })}</option>
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
      <td className="px-2 py-1.5 text-right tabular-nums">{c.planned ? "—" : c.level}</td>
      {showRank && <td className="px-2 py-1.5 text-right tabular-nums">{c.guildRank ?? "—"}</td>}
      <td className="px-2 py-1.5 text-xs text-muted">
        {c.planned ? (
          t("notInGameYet")
        ) : c.syncError ? (
          <span className="text-danger">{t("syncError")}</span>
        ) : c.lastSyncedAt ? (
          format.relativeTime(new Date(c.lastSyncedAt))
        ) : (
          t("pending")
        )}
      </td>
      {showActions && (
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            {c.planned && canEditPlanning && canLink && <LinkForm hasRealms={hasRealms} onLink={(realm, name) => actions.link(c.entryId, realm, name)} />}
            {isOfficer && mainOptions.length > 0 && !c.claimed && (
              <select
                aria-label={t("linkMain")}
                className="input w-24 py-0.5"
                value=""
                onChange={(e) => actions.update(c.entryId, { mainEntryId: e.target.value === AUTO ? null : e.target.value })}
              >
                <option value="">{t("linkMain")}</option>
                {isAlt && <option value={AUTO}>{t("unlink")}</option>}
                {mainOptions.map((m) => (
                  <option key={m.entryId} value={m.entryId}>{m.name}</option>
                ))}
              </select>
            )}
            {(isOfficer || canEditPlanning) && (
              <button
                type="button"
                className="btn px-2 py-0.5"
                title={t("editNote")}
                aria-label={t("editNote")}
                onClick={() => {
                  const note = window.prompt(t("editNote"), c.note ?? "");
                  if (note !== null) void actions.update(c.entryId, { note: note.trim() || null });
                }}
              >
                ✎
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                className="btn px-2 py-0.5"
                title={c.source === "guild" ? t("hide") : t("remove")}
                aria-label={c.source === "guild" ? t("hide") : t("remove")}
                onClick={() => {
                  if (window.confirm(c.source === "guild" ? t("confirmHide", { name: c.name }) : t("confirmRemove", { name: c.name }))) {
                    void actions.remove(c.entryId);
                  }
                }}
              >
                ✕
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

/** Inline form that links a planned entry to the real character once it exists. */
function LinkForm({ hasRealms, onLink }: { hasRealms: boolean; onLink: (realm: string, name: string) => Promise<boolean> }) {
  const t = useTranslations("roster");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setOpen(true)} title={t("linkHelp")}>
        {t("link")}
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        const ok = await onLink(String(data.get("realm")), String(data.get("name")));
        setPending(false);
        if (ok) setOpen(false);
      }}
    >
      <input name="realm" required placeholder={hasRealms ? t("realm") : t("ruleset")} aria-label={hasRealms ? t("realm") : t("ruleset")} className="input w-24 py-0.5" />
      <input name="name" required placeholder={t("name")} aria-label={t("name")} className="input w-24 py-0.5" />
      <button type="submit" className="btn btn-primary px-2 py-0.5" disabled={pending}>
        {pending ? "…" : t("link")}
      </button>
      <button type="button" className="btn px-2 py-0.5" onClick={() => setOpen(false)} aria-label={t("cancel")}>
        ✕
      </button>
    </form>
  );
}
