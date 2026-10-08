import { bisListSchema, type BisList } from "@wow/config";
import { getBisSourceIndex, lookupBisSource, warmBisSourceIndex, type CoreContext } from "@wow/core";

/**
 * Validates a BiS list and fills in the source (drop zone) of any item the client did not tag, from the cached
 * journal index (it never builds the index on a request). When the index is cold, a background build is kicked off
 * so later saves can auto-detect zones; until then those items keep whatever zone the user set by hand, if any.
 */
export async function resolveBisList(
  core: CoreContext,
  target: { version: string; region: string },
  raw: unknown,
): Promise<BisList> {
  const list = bisListSchema.parse(raw);
  if (list.some((item) => !item.source)) {
    const index = await getBisSourceIndex(core, target, { fetchIfMissing: false });
    for (const item of list) {
      if (item.source) continue;
      const source = lookupBisSource(index, item.itemId);
      if (source) item.source = source;
    }
    if (!index) warmBisSourceIndex(core, target);
  }
  // Round-trip through JSON so undefined optionals become absent keys Prisma can store.
  return JSON.parse(JSON.stringify(list)) as BisList;
}
