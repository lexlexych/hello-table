export const downloadPluginSpecifiers = [
  "@livekit/agents-plugin-silero",
  "@livekit/agents-plugin-livekit",
] as const;

export type DownloadPluginSpecifier = (typeof downloadPluginSpecifiers)[number];
export type DownloadPluginImporter = (
  specifier: DownloadPluginSpecifier,
) => Promise<void>;
export type DownloadCliRunner = () => Promise<void>;

async function importDownloadPlugin(
  specifier: DownloadPluginSpecifier,
): Promise<void> {
  switch (specifier) {
    case "@livekit/agents-plugin-silero":
      await import("@livekit/agents-plugin-silero");
      return;
    case "@livekit/agents-plugin-livekit":
      await import("@livekit/agents-plugin-livekit");
      return;
  }
}

async function runDownloadCli(): Promise<void> {
  await import("./index.ts");
}

/** Imports asset-owning plugins before LiveKit CLI enumerates Plugin.registeredPlugins. */
export async function startDownloadFiles(
  importPlugin: DownloadPluginImporter = importDownloadPlugin,
  runCli: DownloadCliRunner = runDownloadCli,
): Promise<void> {
  for (const specifier of downloadPluginSpecifiers) {
    await importPlugin(specifier);
  }
  await runCli();
}
