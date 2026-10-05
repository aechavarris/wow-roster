import { REGIONS } from "@wow/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BLIZZARD_CLIENT_ID: z.string().default(""),
  BLIZZARD_CLIENT_SECRET: z.string().default(""),
  BLIZZARD_REGION: z.enum(REGIONS).default("eu"),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  API_PORT: z.coerce.number().default(4000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = envSchema.parse(source);
  return { ...env, PUBLIC_URL: env.PUBLIC_URL.replace(/\/$/, "") };
}
