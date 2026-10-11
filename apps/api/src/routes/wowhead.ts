import { WOWHEAD_TYPES, WowheadClient, type WowheadType } from "@wow/blizzard";
import { gameVersion } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, unauthorized } from "../errors";

/**
 * Prototype Wowhead proxy. Wowhead has no official API, so this reads its public pages server-side (see
 * WowheadClient) to cover game data Blizzard's API lacks on Classic/Forever — above all an item's source
 * (quest/dungeon/raid), and a general by-name / by-id lookup for items, quests, zones, npcs… The game version
 * only picks the Wowhead domain; pass none for retail. Signed-in users only, so this is not an open proxy.
 */
export async function wowheadRoutes(app: FastifyInstance, { core, versions }: AppDeps) {
  const wowhead = core.wowhead ?? new WowheadClient();
  // A version is only used to choose Wowhead's domain (item ids and data differ per version); default is retail.
  const domainOf = (version?: string) => (version ? gameVersion({ versions }, version).wowheadDomain : "");

  app.get("/wowhead/search", async (request) => {
    if (!request.user) throw unauthorized();
    const q = z
      .object({
        version: z.string().optional(),
        q: z.string().trim().min(2).max(60),
        type: z.enum(WOWHEAD_TYPES as [WowheadType, ...WowheadType[]]).optional(),
      })
      .parse(request.query);
    try {
      return { results: await wowhead.search(q.q, domainOf(q.version), { type: q.type }) };
    } catch {
      throw new HttpError(502, "wowhead_unavailable");
    }
  });

  app.get("/wowhead/items", async (request) => {
    if (!request.user) throw unauthorized();
    const q = z.object({ version: z.string().optional(), filter: z.string().min(1).max(400) }).parse(request.query);
    try {
      return { items: await wowhead.itemsByFilter(q.filter, domainOf(q.version)) };
    } catch {
      throw new HttpError(502, "wowhead_unavailable");
    }
  });

  app.get("/wowhead/:type/:id", async (request) => {
    if (!request.user) throw unauthorized();
    const params = z
      .object({ type: z.enum(WOWHEAD_TYPES as [WowheadType, ...WowheadType[]]), id: z.coerce.number().int().positive() })
      .parse(request.params);
    const query = z.object({ version: z.string().optional() }).parse(request.query);
    try {
      const entity = await wowhead.entity(params.type, params.id, domainOf(query.version));
      if (!entity) throw new HttpError(404, "not_found");
      return { entity };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "wowhead_unavailable");
    }
  });
}
