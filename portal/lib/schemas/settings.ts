import { voiceModeSchema } from "@hello-table/contracts";
import { z } from "zod";

export const voiceSettingsInputSchema = z.object({
  voiceMode: voiceModeSchema,
});

export type VoiceSettingsInput = z.infer<typeof voiceSettingsInputSchema>;
