import { getApps, initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import {
  defaultModelForProvider,
  isModelAvailableForProvider,
  sanitizeCustomModel,
  sanitizeEndpoint,
  type ModelId,
  type ProviderId,
} from "./models";

export type Role = "user" | "assistant";

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

export type Chat = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

export type SettingsState = {
  provider: ProviderId;
  officialApiKey: string;
  nvidiaApiKey: string;
  officialBaseUrl: string;
  nvidiaBaseUrl: string;
  officialCustomModel: string;
  nvidiaCustomModel: string;
  model: ModelId;
  instructions: string;
};

export type PublicSettingsState = Omit<SettingsState, "officialApiKey" | "nvidiaApiKey"> & {
  apiKeySet: boolean;
  officialApiKeySet: boolean;
  nvidiaApiKeySet: boolean;
};

export type StoreState = {
  settings: SettingsState;
  chats: Chat[];
};

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

const defaultSettings: SettingsState = {
  provider: "official",
  officialApiKey: "",
  nvidiaApiKey: "",
  officialBaseUrl: "",
  nvidiaBaseUrl: "",
  officialCustomModel: "",
  nvidiaCustomModel: "",
  model: "deepseek-v4-flash",
  instructions: "You are Chatmio, my private assistant. Be clear, useful, and direct.",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const stateDoc = doc(db, "chatmio", "state");

const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createChat(): Chat {
  const now = Date.now();
  return {
    id: newId(),
    title: "New chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 38 ? `${cleaned.slice(0, 38)}...` : cleaned;
}

function normalizeChat(chat: Chat): Chat {
  const firstUserMessage = chat.messages.find((message) => message.role === "user")?.content;

  if (chat.title === "New chat" && firstUserMessage) {
    return {
      ...chat,
      title: titleFromPrompt(firstUserMessage),
    };
  }

  return chat;
}

function defaultStore(): StoreState {
  return {
    settings: defaultSettings,
    chats: [createChat()],
  };
}

function normalizeStore(value: Partial<StoreState> | null): StoreState {
  const incomingSettings = value?.settings as Partial<SettingsState> & { apiKey?: string } | undefined;
  const provider =
    incomingSettings?.provider === "nvidia" || incomingSettings?.provider === "official"
      ? incomingSettings.provider
      : "official";
  const model = isModelAvailableForProvider(incomingSettings?.model, provider)
    ? incomingSettings!.model!
    : defaultModelForProvider(provider);

  return {
    settings: {
      ...defaultSettings,
      ...(incomingSettings ?? {}),
      provider,
      model,
      officialApiKey: incomingSettings?.officialApiKey ?? incomingSettings?.apiKey ?? "",
      nvidiaApiKey: incomingSettings?.nvidiaApiKey ?? "",
      officialBaseUrl: sanitizeEndpoint(incomingSettings?.officialBaseUrl),
      nvidiaBaseUrl: sanitizeEndpoint(incomingSettings?.nvidiaBaseUrl),
      officialCustomModel: sanitizeCustomModel(incomingSettings?.officialCustomModel),
      nvidiaCustomModel: sanitizeCustomModel(incomingSettings?.nvidiaCustomModel),
    },
    chats: value?.chats?.length ? value.chats.map(normalizeChat) : [createChat()],
  };
}

export async function readStore(): Promise<StoreState> {
  const snapshot = await getDoc(stateDoc);

  if (!snapshot.exists()) {
    const store = defaultStore();
    await writeStore(store);
    return store;
  }

  return normalizeStore(snapshot.data() as Partial<StoreState>);
}

export async function writeStore(store: StoreState) {
  await setDoc(stateDoc, normalizeStore(store));
}

export function toPublicSettings(settings: SettingsState): PublicSettingsState {
  const officialApiKeySet = Boolean(settings.officialApiKey.trim());
  const nvidiaApiKeySet = Boolean(settings.nvidiaApiKey.trim());

  return {
    provider: settings.provider,
    model: settings.model,
    instructions: settings.instructions,
    officialBaseUrl: settings.officialBaseUrl,
    nvidiaBaseUrl: settings.nvidiaBaseUrl,
    officialCustomModel: settings.officialCustomModel,
    nvidiaCustomModel: settings.nvidiaCustomModel,
    apiKeySet: settings.provider === "nvidia" ? nvidiaApiKeySet : officialApiKeySet,
    officialApiKeySet,
    nvidiaApiKeySet,
  };
}
