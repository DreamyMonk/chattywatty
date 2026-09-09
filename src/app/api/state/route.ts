import { isAuthenticated } from "@/lib/auth";
import {
  defaultModelForProvider,
  isModelAvailableForProvider,
  sanitizeCustomModel,
  sanitizeEndpoint,
} from "@/lib/models";
import { readStore, toPublicSettings, writeStore, type Chat, type SettingsState } from "@/lib/store";

export const runtime = "nodejs";

const PROVIDERS = new Set(["official", "nvidia"]);

export async function GET() {
  if (!(await isAuthenticated())) {
    return Response.json({ authenticated: false });
  }

  const store = await readStore();
  return Response.json({
    authenticated: true,
    chats: store.chats,
    settings: toPublicSettings(store.settings),
  });
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    chats?: Chat[];
    settings?: Partial<SettingsState> & { apiKey?: string };
  };
  const current = await readStore();
  const incomingSettings = body.settings ?? {};
  const nextProvider = PROVIDERS.has(incomingSettings.provider ?? "")
    ? incomingSettings.provider!
    : current.settings.provider;
  const nextOfficialApiKey =
    typeof incomingSettings.apiKey === "string" && incomingSettings.apiKey.trim()
      ? nextProvider === "official"
        ? incomingSettings.apiKey.trim()
        : current.settings.officialApiKey
      : current.settings.officialApiKey;
  const nextNvidiaApiKey =
    typeof incomingSettings.apiKey === "string" && incomingSettings.apiKey.trim()
      ? nextProvider === "nvidia"
        ? incomingSettings.apiKey.trim()
        : current.settings.nvidiaApiKey
      : current.settings.nvidiaApiKey;
  const pickText = (
    incoming: string | undefined,
    fallback: string,
    sanitize: (value: string | undefined) => string,
  ) => (typeof incoming === "string" ? sanitize(incoming) : fallback);
  const nextModel = isModelAvailableForProvider(incomingSettings.model, nextProvider)
    ? incomingSettings.model!
    : isModelAvailableForProvider(current.settings.model, nextProvider)
      ? current.settings.model
      : defaultModelForProvider(nextProvider);

  const nextStore = {
    chats: Array.isArray(body.chats) && body.chats.length ? body.chats : current.chats,
    settings: {
      provider: nextProvider,
      officialApiKey: nextOfficialApiKey,
      nvidiaApiKey: nextNvidiaApiKey,
      officialBaseUrl: pickText(
        incomingSettings.officialBaseUrl,
        current.settings.officialBaseUrl,
        sanitizeEndpoint,
      ),
      nvidiaBaseUrl: pickText(incomingSettings.nvidiaBaseUrl, current.settings.nvidiaBaseUrl, sanitizeEndpoint),
      officialCustomModel: pickText(
        incomingSettings.officialCustomModel,
        current.settings.officialCustomModel,
        sanitizeCustomModel,
      ),
      nvidiaCustomModel: pickText(
        incomingSettings.nvidiaCustomModel,
        current.settings.nvidiaCustomModel,
        sanitizeCustomModel,
      ),
      model: nextModel,
      instructions:
        typeof incomingSettings.instructions === "string"
          ? incomingSettings.instructions
          : current.settings.instructions,
    },
  };

  await writeStore(nextStore);

  return Response.json({
    chats: nextStore.chats,
    settings: toPublicSettings(nextStore.settings),
  });
}
