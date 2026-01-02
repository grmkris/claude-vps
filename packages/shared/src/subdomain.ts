import { NUMERIC_CONSTANTS } from "./constants";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

export function generateSubdomain(name: string): string {
  const base = slugify(name);
  const suffix = generateRandomSuffix(NUMERIC_CONSTANTS.subdomain.suffixLength);
  return `${base}-${suffix}`;
}

function generateRandomSuffix(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
