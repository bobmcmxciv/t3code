import type { EnvironmentId } from "@t3tools/contracts";

/**
 * Disabled in self-hosted hardened fork: never nag users for GitHub stars or use server-side
 * GitHub credentials to star repositories.
 */
export async function recordPromptSent(_environmentId: EnvironmentId): Promise<void> {}
