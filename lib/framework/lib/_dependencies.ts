import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

export interface BinaryDependencySpec {
  name: string;
  label: string;
  binaries: string[];
  fallbackPaths?: string[];
  installHint?: string;
  summary?: string;
}

export interface BinaryDependencyDiagnosis {
  name: string;
  label: string;
  installed: boolean;
  detectedCommand?: string;
  installHint?: string;
  summary?: string;
}

async function spawnSucceeded(
  command: string,
  args: string[],
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function isExecutablePathAvailable(filePath: string): Promise<boolean> {
  try {
    await access(
      filePath,
      process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

async function binaryOnPath(binary: string): Promise<boolean> {
  return spawnSucceeded(process.platform === "win32" ? "where" : "which", [
    binary,
  ]);
}

export async function findBinaryDependency(
  spec: BinaryDependencySpec,
): Promise<string | undefined> {
  for (const binary of spec.binaries) {
    if (await binaryOnPath(binary)) return binary;
  }

  for (const candidate of spec.fallbackPaths ?? []) {
    if (await isExecutablePathAvailable(candidate)) return candidate;
  }

  return undefined;
}

export async function diagnoseBinaryDependencies(
  specs: BinaryDependencySpec[],
): Promise<BinaryDependencyDiagnosis[]> {
  const detected = await Promise.all(
    specs.map((spec) => findBinaryDependency(spec)),
  );
  return specs.map((spec, index) => ({
    name: spec.name,
    label: spec.label,
    installed: detected[index] !== undefined,
    detectedCommand: detected[index],
    installHint: spec.installHint,
    summary: spec.summary,
  }));
}

export function formatMissingBinaryDependency(
  diagnosis: BinaryDependencyDiagnosis,
): string {
  const hint = diagnosis.installHint ? ` ${diagnosis.installHint}` : "";
  return `${diagnosis.label} is not installed or not on PATH.${hint}`.trim();
}
