import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Company, CompanyInputT, CompanyPatchT } from "./schema.js";

const DATA_FILE = process.env.COMPANIES_DATA_FILE ?? "./data/companies.json";

async function load(): Promise<Company[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8")) as Company[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function persist(companies: Company[]): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(companies, null, 2));
}

export interface ListOptions {
  q?: string;
  tag?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function list(opts: ListOptions = {}): Promise<Company[]> {
  let companies = await load();
  const { q, tag, status, limit = 50, offset = 0 } = opts;
  if (q) {
    const needle = q.toLowerCase();
    companies = companies.filter((co) =>
      [co.name, co.website, co.notes, co.status, co.fitReason, co.suggestedAngle, co.sourceUrl, ...(co.domains || []), ...(co.tags || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }
  if (tag) companies = companies.filter((co) => (co.tags || []).includes(tag));
  if (status) companies = companies.filter((co) => co.status === status);
  return companies.slice(offset, offset + limit);
}

export async function get(id: string): Promise<Company | null> {
  return (await load()).find((co) => co.id === id) ?? null;
}

export async function findByName(name: string): Promise<Company | null> {
  const needle = name.trim().toLowerCase();
  return (await load()).find((co) => co.name.trim().toLowerCase() === needle) ?? null;
}

export async function create(input: CompanyInputT): Promise<Company> {
  const companies = await load();
  const now = new Date().toISOString();
  const company: Company = { id: randomUUID(), createdAt: now, updatedAt: now, ...input };
  companies.push(company);
  await persist(companies);
  return company;
}

export async function update(id: string, patch: CompanyPatchT): Promise<Company | null> {
  const companies = await load();
  const idx = companies.findIndex((co) => co.id === id);
  if (idx === -1) return null;
  companies[idx] = { ...companies[idx], ...patch, updatedAt: new Date().toISOString() };
  await persist(companies);
  return companies[idx];
}

export async function upsertByName(input: CompanyInputT): Promise<Company> {
  const existing = await findByName(input.name);
  if (!existing) return create(input);
  return (await update(existing.id, { ...input, tags: [...new Set([...(existing.tags || []), ...(input.tags || [])])] }))!;
}

export async function remove(id: string): Promise<boolean> {
  const companies = await load();
  const next = companies.filter((co) => co.id !== id);
  if (next.length === companies.length) return false;
  await persist(next);
  return true;
}
