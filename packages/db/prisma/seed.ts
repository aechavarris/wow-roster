/**
 * Demo data for local development without Blizzard credentials.
 * Run: pnpm --filter @wow/db seed
 */
import { createPrismaClient } from "../src/index";

const prisma = createPrismaClient();

const demoProfile = {
  missing: { professions: "404" },
  equipment: [
    {
      slot: "HEAD",
      itemId: 16866,
      name: "Helm of Ten Storms",
      quality: "EPIC",
      itemLevel: 76,
      enchantments: [{ id: 2583, text: "+10 Stamina / +7 Defense", slot: "PERMANENT" }],
      gems: [],
      setName: "The Ten Storms",
      bonusIds: [],
    },
    { slot: "NECK", itemId: 18404, name: "Onyxia Tooth Pendant", quality: "EPIC", itemLevel: 74, enchantments: [], gems: [], bonusIds: [] },
    { slot: "MAIN_HAND", itemId: 17104, name: "Spinal Reaper", quality: "EPIC", itemLevel: 76, enchantments: [{ text: "Crusader", slot: "PERMANENT" }], gems: [], bonusIds: [] },
  ],
  talents: [
    {
      active: true,
      specName: "Enhancement",
      trees: [
        { name: "Elemental", points: 0, talents: [] },
        { name: "Enhancement", points: 31, talents: [{ id: 1, spellId: 17364, name: "Stormstrike", rank: 1 }] },
        { name: "Restoration", points: 20, talents: [{ id: 2, spellId: 16190, name: "Mana Tide Totem", rank: 1 }] },
      ],
    },
    { active: false, specName: "Restoration", trees: [{ name: "Restoration", points: 51, talents: [] }] },
  ],
  statistics: { health: 6200, power: 5400, strength: 220, agility: 120, intellect: 210, stamina: 300, spirit: 110, armor: 4800, melee_crit: 12.5 },
  reputations: [{ factionId: 1, name: "Cenarion Circle", standing: "Revered", tier: 6 }],
};

async function main() {
  const guild = await prisma.guild.upsert({
    where: { region_realm_slug: { region: "eu", realm: "demo-realm", slug: "demo-guild" } },
    create: {
      region: "eu",
      realm: "demo-realm",
      slug: "demo-guild",
      name: "Demo Guild",
      faction: "HORDE",
      syncIntervalMinutes: 60,
      minLevel: 10,
      lastSyncedAt: new Date(),
      ranks: {
        create: [
          { rank: 0, label: "GM", status: "raider" },
          { rank: 1, label: "Officer", status: "raider" },
          { rank: 2, label: "Raider", status: "raider" },
          { rank: 3, label: "Trial", status: "trial" },
          { rank: 5, label: "Social", status: "social" },
        ],
      },
    },
    update: {},
  });

  const characters = [
    { name: "Thrall", classId: 7, specName: "enhancement", rank: 0, ilvl: 76, profile: demoProfile },
    { name: "Garrosh", classId: 1, specName: "protection", rank: 1, ilvl: 74 },
    { name: "Jaina", classId: 8, specName: "frost", rank: 2, ilvl: 72 },
    { name: "Anduin", classId: 5, specName: "holy", rank: 2, ilvl: 71 },
    { name: "Rexxar", classId: 3, specName: "marksmanship", rank: 3, ilvl: 65 },
    { name: "Valeera", classId: 4, specName: "combat", rank: 5, ilvl: 60 },
    { name: "Thrallalt", classId: 11, specName: "restoration", rank: 5, ilvl: 58 },
  ];

  for (const c of characters) {
    const character = await prisma.character.upsert({
      where: { region_realm_nameKey: { region: "eu", realm: "demo-realm", nameKey: c.name.toLowerCase() } },
      create: {
        region: "eu",
        realm: "demo-realm",
        name: c.name,
        nameKey: c.name.toLowerCase(),
        level: 60,
        classId: c.classId,
        specName: c.specName,
        equippedItemLevel: c.ilvl,
        guildId: guild.id,
        guildRank: c.rank,
        lastSyncedAt: new Date(),
        profile: c.profile ?? undefined,
      },
      update: {},
    });
    await prisma.rosterEntry.upsert({
      where: { guildId_characterId: { guildId: guild.id, characterId: character.id } },
      create: { guildId: guild.id, characterId: character.id, source: "guild" },
      update: {},
    });
  }

  // Link the alt to its main the way an officer would.
  const main = await prisma.rosterEntry.findFirstOrThrow({ where: { guildId: guild.id, character: { nameKey: "thrall" } } });
  await prisma.rosterEntry.updateMany({
    where: { guildId: guild.id, character: { nameKey: "thrallalt" } },
    data: { mainEntryId: main.id },
  });

  console.log(`Seeded demo guild ${guild.id}`);
}

await main();
await prisma.$disconnect();
