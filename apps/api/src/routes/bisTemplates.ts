import { enabledTemplateSources } from "@wow/config";
import { getBisTemplates, warmBisTemplates } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { gameVersionSchema, unauthorized } from "../errors";

/**
 * Curated BiS lists imported from the configured third-party sources (see `BIS_TEMPLATE_SOURCES`). Replaces the
 * old item search: the UI browses these per class/spec and imports one into a character's BiS list. Served from
 * cache; a cold cache warms in the background (the GitHub import never blocks the request). `BIS_SOURCES_ENABLED`
 * (comma-separated source keys) lets the operator choose which sources to offer.
 */
export async function bisTemplateRoutes(app: FastifyInstance, { core, versions, env }: AppDeps) {
  const version = gameVersionSchema(versions);
  const enabledKeys = (env.BIS_SOURCES_ENABLED ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  const keys = enabledKeys.length > 0 ? enabledKeys : undefined;

  app.get("/bis-templates", async (request) => {
    if (!request.user) throw unauthorized();
    const q = z
      .object({ version, classId: z.coerce.number().int().optional(), spec: z.string().max(40).optional() })
      .parse(request.query);

    let templates = await getBisTemplates(core, q.version, { enabledKeys: keys });
    // Nothing cached yet: refresh in the background so the next load has data; this request returns what we have.
    if (templates.length === 0) warmBisTemplates(core, q.version, { enabledKeys: keys });
    if (q.classId !== undefined) templates = templates.filter((t) => t.classId === q.classId);
    if (q.spec) templates = templates.filter((t) => t.spec === q.spec);

    // The sources on offer (even when they have no sets yet), so the UI can show attribution and let the user pick.
    const sources = enabledTemplateSources(q.version, keys).map((s) => ({
      key: s.key,
      name: s.name,
      url: s.url,
      ...(s.popularity !== undefined ? { popularity: s.popularity } : {}),
    }));
    return { templates, sources };
  });
}
