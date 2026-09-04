import { mkdirSync, writeFileSync } from "node:fs";
import { explorerBase } from "./env";

let stepNo = 0;

export function step(title: string): void {
  stepNo += 1;
  console.log(`\n── ${stepNo}. ${title}`);
}

export function ok(message: string): void {
  console.log(`   ✓ ${message}`);
}

export function info(message: string): void {
  console.log(`   · ${message}`);
}

export function warn(message: string): void {
  console.log(`   ! ${message}`);
}

export function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

export const txLink = (hash: string) => `${explorerBase()}/tx/${hash}`;
export const contractLink = (id: string) => `${explorerBase()}/contract/${id}`;
export const accountLink = (id: string) => `${explorerBase()}/account/${id}`;

/** Findings collected by a spike, written to spikes/.out/<name>.json at the end. */
export class Findings {
  private readonly data: Record<string, unknown> = {};
  constructor(private readonly name: string) {}

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }

  write(): string {
    mkdirSync("spikes/.out", { recursive: true });
    const file = `spikes/.out/${this.name}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        { spike: this.name, recordedAt: new Date().toISOString(), network: "testnet", ...this.data },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    );
    return file;
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
