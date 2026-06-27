export type ModelId =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "glm-5.1"
  | "glm-5.2"
  | "minimax-m3";

export type ProviderId = "official" | "nvidia";

export type ModelDefinition = {
  id: ModelId;
  label: string;
  providers: ProviderId[];
  nvidiaModelId?: string;
  nvidiaExperimental?: boolean;
};

export const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    providers: ["official", "nvidia"],
    nvidiaModelId: "deepseek-ai/deepseek-v4-flash",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    providers: ["official", "nvidia"],
    nvidiaModelId: "deepseek-ai/deepseek-v4-pro",
  },
  {
    id: "glm-5.1",
    label: "GLM-5.1",
    providers: ["nvidia"],
    nvidiaModelId: "z-ai/glm-5.1",
  },
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    providers: ["nvidia"],
    nvidiaModelId: "z-ai/glm-5.2",
    nvidiaExperimental: true,
  },
  {
    id: "minimax-m3",
    label: "Minimax M3",
    providers: ["nvidia"],
    nvidiaModelId: "minimaxai/minimax-m3",
  },
];

export const MODEL_IDS = new Set(MODEL_DEFINITIONS.map((model) => model.id));

export function getModelDefinition(modelId: string | undefined) {
  return MODEL_DEFINITIONS.find((model) => model.id === modelId);
}

export function isModelAvailableForProvider(modelId: string | undefined, provider: ProviderId) {
  return Boolean(getModelDefinition(modelId)?.providers.includes(provider));
}

export function defaultModelForProvider(provider: ProviderId): ModelId {
  return provider === "nvidia" ? "deepseek-v4-flash" : "deepseek-v4-flash";
}
