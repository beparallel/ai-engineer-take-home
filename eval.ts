import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = import.meta.dirname;

type Predictions = {
  stays: { id: string; codes: string[] }[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Set overlap (Jaccard) between two code lists, compared as unordered sets:
 * |predicted ∩ reference| / |predicted ∪ reference|.
 * Two empty lists have an empty union, so that case is defined as a perfect 1.
 */
export function codeOverlap(predicted: string[], reference: string[]): number {
  const predictedCodes = new Set(predicted);
  const referenceCodes = new Set(reference);
  const union = new Set([...predictedCodes, ...referenceCodes]);
  if (union.size === 0) return 1;

  let intersection = 0;
  for (const code of predictedCodes) {
    if (referenceCodes.has(code)) intersection += 1;
  }
  return intersection / union.size;
}

/** Macro average: every stay weighs the same, whatever its number of codes. */
export function meanOverlap(overlaps: number[]): number {
  if (overlaps.length === 0) return 0;
  return overlaps.reduce((total, overlap) => total + overlap, 0) / overlaps.length;
}

export function formatOverlap(overlap: number): string {
  return overlap.toFixed(2);
}

function formatCodes(codes: string[]): string {
  return [...codes].sort().join(" ") || "(none)";
}

async function main(): Promise<void> {
  const truthPath = join(root, "data", "ground-truth.json");
  const predictionsPath = join(root, "output", "predictions.json");

  const truth: unknown = JSON.parse(await readFile(truthPath, "utf8"));
  if (!truth || typeof truth !== "object" || Array.isArray(truth)) {
    throw new Error("data/ground-truth.json must be an object mapping stay ids to code arrays.");
  }

  let predictionsRaw: string;
  try {
    predictionsRaw = await readFile(predictionsPath, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error("output/predictions.json is missing. Run this first: npm run agent");
    }
    throw err;
  }
  const predictions = JSON.parse(predictionsRaw) as Predictions;
  if (!predictions || !Array.isArray(predictions.stays)) {
    throw new Error("output/predictions.json must have the shape { stays: [{ id, codes }] }.");
  }

  const predictedById = new Map<string, string[]>();
  for (const stay of predictions.stays) {
    if (!stay || typeof stay.id !== "string" || !isStringArray(stay.codes)) {
      throw new Error("Each predicted stay must have an id and an array of codes.");
    }
    predictedById.set(stay.id, stay.codes);
  }

  const referenceById = truth as Record<string, unknown>;
  const ids = [...new Set([...Object.keys(referenceById), ...predictedById.keys()])].sort();

  const overlaps: number[] = [];
  for (const id of ids) {
    const reference = referenceById[id];
    const predicted = predictedById.get(id) ?? [];
    if (!isStringArray(reference)) {
      throw new Error(`The reference value for ${id} is not an array of codes.`);
    }
    const overlap = codeOverlap(predicted, reference);
    overlaps.push(overlap);
    process.stdout.write(
      [
        `${id}  overlap  ${formatOverlap(overlap)}`,
        `  predicted  ${formatCodes(predicted)}`,
        `  reference  ${formatCodes(reference)}`,
        "",
      ].join("\n"),
    );
  }

  process.stdout.write(
    `mean overlap  ${formatOverlap(meanOverlap(overlaps))}  (${ids.length} stays)\n`,
  );
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
