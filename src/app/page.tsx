"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Ellipsis,
  KeyRound,
  Lightbulb,
  LogOut,
  Mail,
  Menu,
  PanelLeft,
  Pencil,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  FormEvent,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ENDPOINTS,
  MODEL_DEFINITIONS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ModelId,
  type ProviderId,
} from "@/lib/models";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

type SettingsState = {
  apiKey: string;
  apiKeySet: boolean;
  officialApiKeySet: boolean;
  nvidiaApiKeySet: boolean;
  anthropicApiKeySet: boolean;
  provider: ProviderId;
  model: ModelId;
  instructions: string;
  officialBaseUrl: string;
  nvidiaBaseUrl: string;
  anthropicBaseUrl: string;
  officialCustomModel: string;
  nvidiaCustomModel: string;
  anthropicCustomModel: string;
};

type PublicSettings = Omit<SettingsState, "apiKey">;

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

const defaultSettings: SettingsState = {
  apiKey: "",
  apiKeySet: false,
  officialApiKeySet: false,
  nvidiaApiKeySet: false,
  anthropicApiKeySet: false,
  provider: "official",
  model: "deepseek-v4-flash",
  instructions: "You are Chatmio, my private assistant. Be clear, useful, and direct.",
  officialBaseUrl: "",
  nvidiaBaseUrl: "",
  anthropicBaseUrl: "",
  officialCustomModel: "",
  nvidiaCustomModel: "",
  anthropicCustomModel: "",
};

const BASE_URL_KEY = {
  official: "officialBaseUrl",
  nvidia: "nvidiaBaseUrl",
  anthropic: "anthropicBaseUrl",
} as const satisfies Record<ProviderId, keyof SettingsState>;

const CUSTOM_MODEL_KEY = {
  official: "officialCustomModel",
  nvidia: "nvidiaCustomModel",
  anthropic: "anthropicCustomModel",
} as const satisfies Record<ProviderId, keyof SettingsState>;

const KEY_SET_KEY = {
  official: "officialApiKeySet",
  nvidia: "nvidiaApiKeySet",
  anthropic: "anthropicApiKeySet",
} as const satisfies Record<ProviderId, keyof SettingsState>;

const PROVIDER_DETAILS: Record<ProviderId, { hint: string; keyPlaceholder: string; keyLabel: string }> = {
  official: { hint: "Official API", keyPlaceholder: "sk-...", keyLabel: "DeepSeek API key" },
  nvidia: { hint: "NIM catalog", keyPlaceholder: "nvapi-...", keyLabel: "NVIDIA NIM API key" },
  anthropic: { hint: "Anthropic API", keyPlaceholder: "sk-ant-...", keyLabel: "Claude API key" },
};

const SUGGESTIONS = [
  { icon: Lightbulb, label: "Explain a concept", prompt: "Explain how vaccines train the immune system, in simple terms." },
  { icon: Code, label: "Debug some code", prompt: "Help me find the bug in this function:\n\n" },
  { icon: Mail, label: "Draft an email", prompt: "Draft a polite email asking my manager for a day off next Friday." },
  { icon: Sparkles, label: "Brainstorm ideas", prompt: "Give me 10 creative weekend project ideas I can finish in two days." },
];

const THINKING_START = "[[CHATMIO_THINKING_START]]";
const THINKING_END = "[[CHATMIO_THINKING_END]]";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

function createMessage(role: Role, content: string): Message {
  return { id: newId(), role, content, createdAt: Date.now() };
}

function fromPublicSettings(data: Partial<PublicSettings> | undefined): SettingsState {
  return { ...defaultSettings, ...(data ?? {}), apiKey: "" };
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 38 ? `${cleaned.slice(0, 38)}...` : cleaned;
}

function chatDisplayTitle(chat: Chat | undefined) {
  if (!chat) return "Chatmio";
  const firstUserMessage = chat.messages.find((message) => message.role === "user")?.content;

  if (chat.title === "New chat" && firstUserMessage) {
    return titleFromPrompt(firstUserMessage);
  }

  return chat.title;
}

function groupChats(chats: Chat[]) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups = [
    { label: "Today", since: startOfToday, chats: [] as Chat[] },
    { label: "Yesterday", since: startOfToday - day, chats: [] as Chat[] },
    { label: "Previous 7 days", since: startOfToday - 7 * day, chats: [] as Chat[] },
    { label: "Previous 30 days", since: startOfToday - 30 * day, chats: [] as Chat[] },
    { label: "Older", since: -Infinity, chats: [] as Chat[] },
  ];

  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    groups.find((group) => chat.updatedAt >= group.since)?.chats.push(chat);
  }

  return groups.filter((group) => group.chats.length);
}

function splitThinkingContent(content: string) {
  const startIndex = content.indexOf(THINKING_START);

  if (startIndex === -1) {
    return {
      thinking: "",
      answer: content,
    };
  }

  const before = content.slice(0, startIndex);
  const afterStart = content.slice(startIndex + THINKING_START.length);
  const endIndex = afterStart.indexOf(THINKING_END);

  if (endIndex === -1) {
    return {
      thinking: afterStart,
      answer: before,
    };
  }

  return {
    thinking: afterStart.slice(0, endIndex),
    answer: `${before}${afterStart.slice(endIndex + THINKING_END.length)}`,
  };
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = useCallback((text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }, []);

  return [copied, copy];
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, copy] = useCopy();
  const child = Array.isArray(children) ? children[0] : children;
  const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
  const language = /language-([\w+#-]+)/.exec(className)?.[1] ?? "";
  const code = textOf(children).replace(/\n$/, "");

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-white/10 bg-[#171717] last:mb-0">
      <div className="flex items-center justify-between bg-[#2a2a2a] px-4 py-2 text-xs text-[#b4b4b4]">
        <span className="font-mono">{language || "code"}</span>
        <button
          type="button"
          onClick={() => copy(code)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition hover:text-white"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-[#e6e6e6]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-4 leading-7 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-2xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="mb-4 list-disc space-y-1.5 pl-6 leading-7 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal space-y-1.5 pl-6 leading-7 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1 marker:text-[#8f8f8f]">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2 hover:text-sky-200">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-4 border-white/15 pl-4 text-[#c8c8c8] last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-white/10" />,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto rounded-xl border border-white/10 last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
  th: ({ children }) => <th className="border-b border-white/10 px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-white/5 px-3 py-2 align-top">{children}</td>,
  code: ({ children }) => (
    <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.875em] text-[#f0f0f0]">{children}</code>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}

function ActionButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg text-[#b4b4b4] transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  children,
  onClick,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#b4b4b4] transition hover:bg-white/10 hover:text-white ${className}`}
    >
      {children}
    </button>
  );
}

function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 text-sm text-[#b4b4b4] transition hover:text-white"
      >
        <span className={`font-medium ${active ? "thinking-shimmer" : ""}`}>{active ? "Thinking" : "Reasoning"}</span>
        <ChevronRight size={15} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open ? (
        <div className="mt-2 max-h-96 overflow-y-auto border-l-2 border-white/10 pl-4 text-sm leading-6 text-[#b4b4b4]">
          <MarkdownBlock content={text} />
        </div>
      ) : null}
    </div>
  );
}

function EditBox({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 320)}px`;
  }, [draft]);

  useEffect(() => {
    const element = ref.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);

  const submit = () => {
    if (draft.trim()) onSubmit(draft.trim());
  };

  return (
    <div className="w-full rounded-3xl bg-[#303030] p-3">
      <textarea
        ref={ref}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") onCancel();
        }}
        rows={1}
        className="w-full resize-none bg-transparent px-2 py-1 leading-7 text-[#ececec] outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-[#212121] px-4 py-2 text-sm font-medium text-[#ececec] transition hover:bg-black/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/85 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isStreamingThis,
  isLast,
  busy,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  onRegenerate,
}: {
  message: Message;
  isStreamingThis: boolean;
  isLast: boolean;
  busy: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSubmitEdit: (text: string) => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  const [copied, copy] = useCopy();
  const { thinking, answer } = splitThinkingContent(message.content);

  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end">
        {isEditing ? (
          <EditBox initial={message.content} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />
        ) : (
          <>
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-[#303030] px-5 py-2.5 leading-7 text-[#ececec]">
              {message.content}
            </div>
            <div className="mt-1 flex gap-0.5 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
              <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => copy(message.content)}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </ActionButton>
              <ActionButton label="Edit message" onClick={onStartEdit} disabled={busy}>
                <Pencil size={16} />
              </ActionButton>
              <ActionButton label="Delete message" onClick={onDelete} disabled={busy}>
                <Trash2 size={16} />
              </ActionButton>
            </div>
          </>
        )}
      </div>
    );
  }

  const isError = answer.trimStart().startsWith("Error:");
  const thinkingActive = isStreamingThis && !answer.trim();

  return (
    <div className="group flex gap-4">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 bg-[#212121] text-[#ececec]">
        <Sparkles size={15} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {thinking.trim() ? <ThinkingBlock text={thinking} active={thinkingActive} /> : null}

        {answer.trim() ? (
          isError ? (
            <div className="rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200">
              <MarkdownBlock content={answer.trim().replace(/^Error:\s*/, "")} />
            </div>
          ) : (
            <div className="break-words text-[15px] text-[#ececec]">
              <MarkdownBlock content={answer} />
            </div>
          )
        ) : isStreamingThis ? (
          thinking.trim() ? null : <span className="mt-2 inline-block h-3.5 w-3.5 animate-pulse rounded-full bg-white" />
        ) : (
          <p className="text-sm text-[#8f8f8f]">No response saved.</p>
        )}

        {!isStreamingThis ? (
          <div
            className={`mt-2 flex gap-0.5 transition ${
              isLast ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
            }`}
          >
            <ActionButton label={copied ? "Copied" : "Copy"} onClick={() => copy(answer.trim())}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </ActionButton>
            {isLast ? (
              <ActionButton label="Regenerate" onClick={onRegenerate} disabled={busy}>
                <RefreshCw size={16} />
              </ActionButton>
            ) : null}
            <ActionButton label="Delete message" onClick={onDelete} disabled={busy}>
              <Trash2 size={16} />
            </ActionButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const fieldClass =
  "h-11 w-full rounded-xl border border-white/10 bg-[#212121] px-3 text-sm text-[#ececec] outline-none transition placeholder:text-[#6f6f6f] focus:border-white/25";

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebar, setDesktopSidebar] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [chatMenu, setChatMenu] = useState<{ chatId: string; top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const lastLocalChangeRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);

  const isStreaming = streamingId !== null;

  const markLocalChange = useCallback(() => {
    pendingSyncRef.current = true;
    lastLocalChangeRef.current = Date.now();
  }, []);

  const loadState = useCallback(async (force = false) => {
    if (!force && (pendingSyncRef.current || Date.now() - lastLocalChangeRef.current < 1500)) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("/api/state", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not load synced state.");

      const data = (await response.json()) as {
        authenticated?: boolean;
        chats?: Chat[];
        settings?: PublicSettings;
      };

      if (data.authenticated === false) {
        setAuthenticated(false);
        setHydrated(true);
        return;
      }

      const nextChats = data.chats?.length ? data.chats : [createChat()];

      setChats(nextChats);
      setActiveChatId((current) =>
        current && nextChats.some((chat) => chat.id === current) ? current : nextChats[0].id,
      );
      setSettings(fromPublicSettings(data.settings));
      setAuthenticated(true);
      setHydrated(true);
      setError("");
    } catch {
      setAuthenticated(false);
      setHydrated(true);
      setError("Firebase sync is taking too long. You can still unlock and try again.");
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  const saveState = useCallback(
    async (nextChats: Chat[], nextSettings: SettingsState, { includeKey = false } = {}) => {
      pendingSyncRef.current = true;
      const sentKey = includeKey ? nextSettings.apiKey : "";

      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chats: nextChats,
            settings: {
              apiKey: sentKey,
              provider: nextSettings.provider,
              model: nextSettings.model,
              instructions: nextSettings.instructions,
              officialBaseUrl: nextSettings.officialBaseUrl,
              nvidiaBaseUrl: nextSettings.nvidiaBaseUrl,
              anthropicBaseUrl: nextSettings.anthropicBaseUrl,
              officialCustomModel: nextSettings.officialCustomModel,
              nvidiaCustomModel: nextSettings.nvidiaCustomModel,
              anthropicCustomModel: nextSettings.anthropicCustomModel,
            },
          }),
        });

        if (!response.ok) throw new Error("Could not sync changes.");
        const data = (await response.json()) as { settings: PublicSettings };
        // Only take the key flags back: the text fields may have been edited while this was in flight.
        setSettings((current) => ({
          ...current,
          apiKey: sentKey && current.apiKey === sentKey ? "" : current.apiKey,
          apiKeySet: data.settings[KEY_SET_KEY[current.provider]],
          officialApiKeySet: data.settings.officialApiKeySet,
          nvidiaApiKeySet: data.settings.nvidiaApiKeySet,
          anthropicApiKeySet: data.settings.anthropicApiKeySet,
        }));
      } finally {
        pendingSyncRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    // Hydrate the client view from the server-backed store after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadState(true);
  }, [loadState]);

  useEffect(() => {
    if (!hydrated || !authenticated || !chats.length) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      saveState(chats, settings).catch(() => setError("Could not sync changes."));
    }, 700);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [authenticated, chats, hydrated, saveState, settings]);

  useEffect(() => {
    if (!authenticated || isStreaming || settingsOpen || editingId) return;

    const interval = setInterval(() => {
      loadState();
    }, 3000);

    return () => clearInterval(interval);
  }, [authenticated, editingId, isStreaming, loadState, settingsOpen]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeChatId]);

  useEffect(() => {
    const element = scrollAreaRef.current;
    if (element && stickToBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [activeChatId, chats]);

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [input, activeChatId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChatMenu(null);
      setModelMenuOpen(false);
      setConfirm(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? chats[0],
    [activeChatId, chats],
  );
  const chatGroups = useMemo(() => groupChats(chats), [chats]);

  const provider = settings.provider;
  const isClaude = provider === "anthropic";
  const baseUrlKey = BASE_URL_KEY[provider];
  const customModelKey = CUSTOM_MODEL_KEY[provider];
  const activeBaseUrl = settings[baseUrlKey];
  const activeCustomModel = settings[customModelKey];
  const activeModelLabel = isClaude
    ? activeCustomModel || DEFAULT_ANTHROPIC_MODEL
    : activeCustomModel || MODEL_DEFINITIONS.find((model) => model.id === settings.model)?.label || settings.model;
  const isEmptyChat = !activeChat?.messages.length;

  function updateChat(chatId: string, updater: (chat: Chat) => Chat) {
    markLocalChange();
    setChats((currentChats) => currentChats.map((chat) => (chat.id === chatId ? updater(chat) : chat)));
  }

  function updateSettings(updater: (current: SettingsState) => SettingsState) {
    markLocalChange();
    setSettings(updater);
  }

  function switchProvider(nextProvider: ProviderId) {
    updateSettings((current) => {
      const modelStillValid =
        nextProvider === "anthropic" ||
        MODEL_DEFINITIONS.some((model) => model.id === current.model && model.providers.includes(nextProvider));

      return {
        ...current,
        apiKey: "",
        apiKeySet: current[KEY_SET_KEY[nextProvider]],
        provider: nextProvider,
        model: modelStillValid ? current.model : "deepseek-v4-flash",
      };
    });
  }

  function toggleSidebar() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopSidebar((open) => !open);
    } else {
      setSidebarOpen((open) => !open);
    }
  }

  function handleScroll() {
    const element = scrollAreaRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distance < 120;
    setShowScrollDown(distance > 240);
  }

  function scrollToBottom() {
    const element = scrollAreaRef.current;
    if (!element) return;
    stickToBottomRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }

  function startNewChat() {
    setSidebarOpen(false);
    setEditingId(null);
    setError("");

    // Reuse an untouched chat instead of piling up empty ones.
    const blank = chats.find((chat) => !chat.messages.length);
    if (blank) {
      setActiveChatId(blank.id);
      composerRef.current?.focus();
      return;
    }

    const chat = createChat();
    markLocalChange();
    setChats((currentChats) => [chat, ...currentChats]);
    setActiveChatId(chat.id);
  }

  function deleteChat(chatId: string) {
    markLocalChange();
    setChats((currentChats) => {
      const remaining = currentChats.filter((chat) => chat.id !== chatId);
      const nextChats = remaining.length ? remaining : [createChat()];
      if (chatId === activeChatId) setActiveChatId(nextChats[0].id);
      saveState(nextChats, settings).catch(() => setError("Could not sync deleted chat."));
      return nextChats;
    });
  }

  function confirmDeleteChat(chat: Chat) {
    setChatMenu(null);
    setConfirm({
      title: "Delete chat?",
      body: `This will delete "${chatDisplayTitle(chat)}" and all of its messages.`,
      confirmLabel: "Delete",
      onConfirm: () => deleteChat(chat.id),
    });
  }

  function commitRename(chat: Chat, value: string) {
    setRenamingId(null);
    const nextTitle = value.trim();
    if (!nextTitle || nextTitle === chatDisplayTitle(chat)) return;
    updateChat(chat.id, (current) => ({ ...current, title: nextTitle, updatedAt: Date.now() }));
  }

  function deleteMessage(message: Message) {
    if (!activeChat) return;
    const chatId = activeChat.id;
    const messages = activeChat.messages;
    const index = messages.findIndex((item) => item.id === message.id);
    const removeIds = new Set([message.id]);
    // A prompt and the reply it produced go together.
    if (message.role === "user" && messages[index + 1]?.role === "assistant") {
      removeIds.add(messages[index + 1].id);
    }

    setConfirm({
      title: "Delete message?",
      body:
        removeIds.size > 1
          ? "This removes your message and the reply to it."
          : "This removes the message from the chat.",
      confirmLabel: "Delete",
      onConfirm: () =>
        updateChat(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.filter((item) => !removeIds.has(item.id)),
          updatedAt: Date.now(),
        })),
    });
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      await loadState(true);
      setLoginError("");
      return;
    }

    setLoginError("Wrong password.");
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAuthenticated(false);
    setSidebarOpen(false);
    setSettingsOpen(false);
  }

  async function saveSettings() {
    try {
      await saveState(chats, settings, { includeKey: true });
      setSettingsOpen(false);
      setError("");
    } catch {
      setError("Could not save settings to the server.");
    }
  }

  function appendAssistantTextChunk(chatId: string, messageId: string, text: string) {
    updateChat(chatId, (chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.id === messageId ? { ...message, content: message.content + text } : message,
      ),
      updatedAt: Date.now(),
    }));
  }

  async function appendAssistantText(chatId: string, messageId: string, text: string) {
    if (text.includes(THINKING_END) && text !== THINKING_END) {
      const endIndex = text.indexOf(THINKING_END);
      const markerPart = text.slice(0, endIndex + THINKING_END.length);
      const answerPart = text.slice(endIndex + THINKING_END.length);

      if (markerPart) {
        appendAssistantTextChunk(chatId, messageId, markerPart);
      }

      if (answerPart) {
        await appendAssistantText(chatId, messageId, answerPart);
      }

      return;
    }

    const pieces =
      text.length > 80 && !text.includes(THINKING_START) && !text.includes(THINKING_END)
        ? (text.match(/[\s\S]{1,4}/g) ?? [text])
        : [text];

    for (const piece of pieces) {
      appendAssistantTextChunk(chatId, messageId, piece);

      if (pieces.length > 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
    }
  }

  function stopResponse() {
    chatAbortRef.current?.abort();
  }

  function ensureApiKey() {
    if (settings.apiKeySet || settings.apiKey.trim()) return true;
    setSettingsOpen(true);
    setError(`Add your ${PROVIDER_LABELS[provider]} API key before sending.`);
    return false;
  }

  /**
   * Sends `promptText` after `history`. Edit and regenerate pass a shortened history, which is
   * saved first so the server appends the new reply to the trimmed chat instead of the old one.
   */
  async function runReply(chat: Chat, history: Message[], promptText: string, existingUser?: Message) {
    if (isStreaming || !ensureApiKey()) return;

    const userMessage = existingUser ?? createMessage("user", promptText);
    const assistantMessage = createMessage("assistant", "");
    const rewritesHistory = history.length !== chat.messages.length;

    if (rewritesHistory || settings.apiKey.trim()) {
      const savedChats = chats.map((item) =>
        item.id === chat.id ? { ...item, messages: [...history, userMessage], updatedAt: Date.now() } : item,
      );
      try {
        await saveState(savedChats, settings, { includeKey: true });
      } catch {
        setError("Could not sync the chat before sending.");
        return;
      }
    }

    setError("");
    setEditingId(null);
    setStreamingId(assistantMessage.id);
    stickToBottomRef.current = true;

    const requestController = new AbortController();
    chatAbortRef.current = requestController;

    const nextMessages = [...history, userMessage, assistantMessage];
    updateChat(chat.id, (current) => ({
      ...current,
      title: current.title === "New chat" && !history.length ? titleFromPrompt(promptText) : current.title,
      messages: nextMessages,
      updatedAt: Date.now(),
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          title: history.length ? chatDisplayTitle(chat) : titleFromPrompt(promptText),
          userMessage,
          assistantMessage,
          messages: nextMessages
            .filter((message) => message.content.trim())
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(problem?.error || "The model request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        await appendAssistantText(chat.id, assistantMessage.id, decoder.decode(value, { stream: true }));
      }
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") {
        await appendAssistantText(chat.id, assistantMessage.id, "\n\n_Stopped._");
        return;
      }

      const message = sendError instanceof Error ? sendError.message : "Something went wrong.";
      updateChat(chat.id, (current) => ({
        ...current,
        messages: current.messages.map((chatMessage) =>
          chatMessage.id === assistantMessage.id ? { ...chatMessage, content: `Error: ${message}` } : chatMessage,
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      if (chatAbortRef.current === requestController) chatAbortRef.current = null;
      setStreamingId((current) => (current === assistantMessage.id ? null : current));
    }
  }

  function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const promptText = input.trim();
    if (!promptText || !activeChat || isStreaming || !ensureApiKey()) return;
    setInput("");
    void runReply(activeChat, activeChat.messages, promptText);
  }

  function submitEdit(message: Message, text: string) {
    if (!activeChat) return;
    const index = activeChat.messages.findIndex((item) => item.id === message.id);
    if (index === -1) return;
    void runReply(activeChat, activeChat.messages.slice(0, index), text);
  }

  function regenerate(message: Message) {
    if (!activeChat) return;
    const index = activeChat.messages.findIndex((item) => item.id === message.id);
    const prompt = activeChat.messages[index - 1];
    if (index < 1 || prompt?.role !== "user") return;
    void runReply(activeChat, activeChat.messages.slice(0, index - 1), prompt.content, prompt);
  }

  if (!hydrated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#212121]">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#212121] px-5 text-[#ececec]">
        <form onSubmit={login} className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-white text-black shadow-lg shadow-black/30">
              <Sparkles size={26} />
            </div>
            <h1 className="text-3xl font-semibold">Welcome back</h1>
            <p className="mt-2 text-sm text-[#b4b4b4]">Unlock your private Chatmio workspace.</p>
          </div>
          <label className="sr-only" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-12 w-full rounded-full border border-white/15 bg-[#2f2f2f] px-5 text-[#ececec] outline-none transition placeholder:text-[#8f8f8f] focus:border-white/35"
            autoFocus
          />
          {error ? <p className="mt-3 text-center text-sm text-amber-200">{error}</p> : null}
          {loginError ? <p className="mt-3 text-center text-sm text-red-300">{loginError}</p> : null}
          <button className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white font-medium text-black transition hover:bg-white/85">
            <KeyRound size={18} />
            Unlock
          </button>
        </form>
      </main>
    );
  }

  const composer = (
    <form onSubmit={sendMessage} className="w-full">
      <div className="flex items-end gap-2 rounded-[28px] bg-[#303030] py-2 pl-5 pr-2 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.25)] transition focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_10px_30px_rgba(0,0,0,0.3)]">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={`Message ${activeModelLabel}`}
          rows={1}
          autoFocus
          className="max-h-[220px] min-h-10 flex-1 resize-none bg-transparent py-2 leading-6 text-[#ececec] outline-none placeholder:text-[#8f8f8f]"
        />
        {isStreaming ? (
          <button
            type="button"
            aria-label="Stop response"
            title="Stop response"
            onClick={stopResponse}
            className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/85"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send message"
            title="Send message"
            disabled={!input.trim()}
            className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-white/85 disabled:bg-white/20 disabled:text-[#8f8f8f]"
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  );

  const errorBanner = error ? (
    <div className="mb-3 flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
      <p className="flex-1">{error}</p>
      <button type="button" aria-label="Dismiss" onClick={() => setError("")} className="mt-0.5 text-red-200/70 hover:text-red-100">
        <X size={15} />
      </button>
    </div>
  ) : null;

  const menuChat = chatMenu ? chats.find((chat) => chat.id === chatMenu.chatId) : undefined;

  return (
    <main className="flex h-dvh overflow-hidden bg-[#212121] text-[#ececec]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 overflow-hidden bg-[#171717] transition-all duration-200 md:relative md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${desktopSidebar ? "md:w-[260px]" : "md:w-0"} w-[280px]`}
      >
        <div className="flex h-full w-[280px] flex-col md:w-[260px]">
          <div className="flex h-14 items-center justify-between px-2">
            <IconButton label="Close sidebar" onClick={toggleSidebar}>
              <PanelLeft size={20} />
            </IconButton>
            <IconButton label="New chat" onClick={startNewChat}>
              <SquarePen size={19} />
            </IconButton>
          </div>

          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={startNewChat}
              className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-[#ececec] transition hover:bg-white/[0.06]"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-black">
                <Sparkles size={14} />
              </span>
              <span className="font-medium">Chatmio</span>
              <SquarePen size={16} className="ml-auto text-[#b4b4b4]" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            {chatGroups.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="sticky top-0 z-[1] bg-[#171717] px-2.5 pb-1 pt-2 text-xs font-medium text-[#8f8f8f]">
                  {group.label}
                </p>
                {group.chats.map((chat) => {
                  const isActive = chat.id === activeChat?.id;
                  const isMenuOpen = chatMenu?.chatId === chat.id;

                  return (
                    <div
                      key={chat.id}
                      className={`group relative flex h-9 items-center rounded-lg transition ${
                        isActive ? "bg-[#2f2f2f]" : "hover:bg-white/[0.06]"
                      }`}
                    >
                      {renamingId === chat.id ? (
                        <input
                          autoFocus
                          defaultValue={chatDisplayTitle(chat)}
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={(event) => commitRename(chat, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") {
                              event.currentTarget.value = chatDisplayTitle(chat);
                              event.currentTarget.blur();
                            }
                          }}
                          className="mx-1 h-7 min-w-0 flex-1 rounded-md border border-white/20 bg-[#212121] px-2 text-sm text-[#ececec] outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChatId(chat.id);
                            setEditingId(null);
                            setSidebarOpen(false);
                          }}
                          className="h-full min-w-0 flex-1 truncate rounded-lg px-2.5 text-left text-sm text-[#ececec]"
                        >
                          {chatDisplayTitle(chat)}
                        </button>
                      )}
                      {renamingId !== chat.id ? (
                        <button
                          type="button"
                          aria-label="Chat options"
                          title="Chat options"
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setChatMenu(isMenuOpen ? null : { chatId: chat.id, top: rect.bottom + 4, left: rect.left });
                          }}
                          className={`mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#b4b4b4] transition hover:text-white ${
                            isActive || isMenuOpen ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          }`}
                        >
                          <Ellipsis size={16} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-white/[0.06] p-2">
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(true);
                setSidebarOpen(false);
              }}
              className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-[#ececec] transition hover:bg-white/[0.06]"
            >
              <Settings size={17} className="text-[#b4b4b4]" />
              <span className="min-w-0 flex-1 truncate text-left">Settings</span>
              <span className="truncate text-xs text-[#8f8f8f]">{PROVIDER_LABELS[provider]}</span>
            </button>
            <button
              type="button"
              onClick={logout}
              className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-[#ececec] transition hover:bg-white/[0.06]"
            >
              <LogOut size={17} className="text-[#b4b4b4]" />
              Lock app
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2">
          <IconButton label="Open sidebar" onClick={() => setSidebarOpen(true)} className="md:hidden">
            <Menu size={20} />
          </IconButton>
          {!desktopSidebar ? (
            <>
              <IconButton label="Open sidebar" onClick={toggleSidebar} className="hidden md:grid">
                <PanelLeft size={20} />
              </IconButton>
              <IconButton label="New chat" onClick={startNewChat} className="hidden md:grid">
                <SquarePen size={19} />
              </IconButton>
            </>
          ) : null}

          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setModelMenuOpen((open) => !open)}
              className="flex h-10 min-w-0 items-center gap-1.5 rounded-lg px-3 text-lg transition hover:bg-white/[0.06]"
            >
              <span className="font-medium">Chatmio</span>
              <span className="truncate text-[#b4b4b4]">{activeModelLabel}</span>
              <ChevronDown size={16} className="shrink-0 text-[#b4b4b4]" />
            </button>

            {modelMenuOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Close model menu"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setModelMenuOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-1rem))] rounded-2xl border border-white/10 bg-[#2f2f2f] p-1.5 shadow-2xl shadow-black/50">
                  <p className="px-3 pb-1 pt-1.5 text-xs text-[#8f8f8f]">{PROVIDER_LABELS[provider]} model</p>
                  {isClaude ? (
                    <div className="flex items-center gap-3 rounded-xl px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{activeModelLabel}</p>
                        <p className="text-xs text-[#8f8f8f]">Change the model name in Settings</p>
                      </div>
                      <Check size={16} />
                    </div>
                  ) : (
                    <>
                      {MODEL_DEFINITIONS.filter((model) => model.providers.includes(provider)).map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            updateSettings((current) => ({ ...current, model: model.id }));
                            setModelMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {model.label}
                            {model.nvidiaExperimental ? (
                              <span className="ml-2 text-xs text-[#8f8f8f]">experimental</span>
                            ) : null}
                          </span>
                          {settings.model === model.id && !activeCustomModel ? <Check size={16} /> : null}
                        </button>
                      ))}
                      {activeCustomModel ? (
                        <div className="flex items-center gap-3 rounded-xl px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{activeCustomModel}</p>
                            <p className="text-xs text-[#8f8f8f]">Custom model ID overrides the list</p>
                          </div>
                          <Check size={16} />
                        </div>
                      ) : null}
                    </>
                  )}
                  <div className="my-1.5 h-px bg-white/10" />
                  <p className="px-3 pb-1 pt-1 text-xs text-[#8f8f8f]">Provider</p>
                  {PROVIDER_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        switchProvider(id);
                        setModelMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {PROVIDER_LABELS[id]}
                        <span className="ml-2 text-xs text-[#8f8f8f]">{PROVIDER_DETAILS[id].hint}</span>
                      </span>
                      {provider === id ? <Check size={16} /> : null}
                    </button>
                  ))}
                  <div className="my-1.5 h-px bg-white/10" />
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(true);
                      setModelMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]"
                  >
                    <Settings size={16} className="text-[#b4b4b4]" />
                    Settings
                  </button>
                </div>
              </>
            ) : null}
          </div>

          <div className="flex-1" />
          <IconButton label="New chat" onClick={startNewChat} className="md:hidden">
            <SquarePen size={19} />
          </IconButton>
        </header>

        {isEmptyChat ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[8vh]">
            <h1 className="mb-8 text-center text-[28px] font-medium tracking-tight sm:text-3xl">What can I help with?</h1>
            <div className="w-full max-w-3xl">
              {errorBanner}
              {composer}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setInput(prompt);
                      composerRef.current?.focus();
                    }}
                    className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-sm text-[#b4b4b4] transition hover:bg-white/[0.06] hover:text-[#ececec]"
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pb-10 pt-4 sm:px-6">
                {activeChat.messages.map((message, index) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    isStreamingThis={streamingId === message.id}
                    isLast={index === activeChat.messages.length - 1}
                    busy={isStreaming}
                    isEditing={editingId === message.id}
                    onStartEdit={() => setEditingId(message.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSubmitEdit={(text) => submitEdit(message, text)}
                    onDelete={() => deleteMessage(message)}
                    onRegenerate={() => regenerate(message)}
                  />
                ))}
              </div>
            </div>

            <div className="relative shrink-0 px-4 pb-3 sm:px-6">
              {showScrollDown ? (
                <button
                  type="button"
                  aria-label="Scroll to bottom"
                  onClick={scrollToBottom}
                  className="absolute -top-12 left-1/2 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-white/10 bg-[#2f2f2f] text-[#ececec] shadow-lg transition hover:bg-[#3a3a3a]"
                >
                  <ArrowDown size={17} />
                </button>
              ) : null}
              <div className="mx-auto max-w-3xl">
                {errorBanner}
                {composer}
                <p className="mt-2 text-center text-xs text-[#8f8f8f]">
                  Chatmio can make mistakes. Check important info.
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {chatMenu && menuChat ? (
        <>
          <button
            type="button"
            aria-label="Close chat menu"
            className="fixed inset-0 z-50 cursor-default"
            onClick={() => setChatMenu(null)}
          />
          <div
            className="fixed z-[60] w-44 rounded-2xl border border-white/10 bg-[#2f2f2f] p-1.5 shadow-2xl shadow-black/50"
            style={{ top: Math.min(chatMenu.top, window.innerHeight - 110), left: Math.min(chatMenu.left, window.innerWidth - 184) }}
          >
            <button
              type="button"
              onClick={() => {
                setRenamingId(menuChat.id);
                setChatMenu(null);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]"
            >
              <Pencil size={15} />
              Rename
            </button>
            <button
              type="button"
              onClick={() => confirmDeleteChat(menuChat)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-red-400 transition hover:bg-red-500/10"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </>
      ) : null}

      {confirm ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#2f2f2f] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">{confirm.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#b4b4b4]">{confirm.body}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium transition hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  confirm.onConfirm();
                  setConfirm(null);
                }}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <section className="flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-white/10 bg-[#2f2f2f] shadow-2xl sm:max-w-xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold">Settings</h2>
                <p className="text-sm text-[#8f8f8f]">Provider, key, model and instructions</p>
              </div>
              <IconButton label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <div>
                <p className="mb-2 text-sm font-medium">Provider</p>
                <div className="grid grid-cols-3 gap-2">
                  {PROVIDER_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => switchProvider(id)}
                      className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                        provider === id
                          ? "border-white bg-white text-black"
                          : "border-white/10 bg-[#212121] text-[#ececec] hover:border-white/25"
                      }`}
                    >
                      <span className="block text-sm font-medium">{PROVIDER_LABELS[id]}</span>
                      <span className={`block text-xs ${provider === id ? "text-black/60" : "text-[#8f8f8f]"}`}>
                        {PROVIDER_DETAILS[id].hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="apiKey">
                  {activeBaseUrl ? `API key / token (${PROVIDER_LABELS[provider]} custom endpoint)` : PROVIDER_DETAILS[provider].keyLabel}
                </label>
                <input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  value={settings.apiKey}
                  onChange={(event) => updateSettings((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={
                    settings.apiKeySet ? "Saved. Type a new key to replace it." : PROVIDER_DETAILS[provider].keyPlaceholder
                  }
                  className={fieldClass}
                />
                {settings.apiKeySet ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-300">
                    <Check size={13} />
                    Key saved in Firebase. It is never sent back to the browser.
                  </p>
                ) : null}
              </div>

              {isClaude ? (
                <div>
                  <label className="mb-2 block text-sm font-medium" htmlFor="claudeModel">
                    Model name
                  </label>
                  <input
                    id="claudeModel"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={activeCustomModel}
                    onChange={(event) =>
                      updateSettings((current) => ({ ...current, anthropicCustomModel: event.target.value }))
                    }
                    placeholder={DEFAULT_ANTHROPIC_MODEL}
                    className={fieldClass}
                  />
                  <p className="mt-1.5 text-xs leading-5 text-[#8f8f8f]">
                    Any Claude model ID your key can use, e.g. <code className="text-[#c8c8c8]">claude-opus-5-5</code>,{" "}
                    <code className="text-[#c8c8c8]">claude-sonnet-5-5</code> or{" "}
                    <code className="text-[#c8c8c8]">claude-haiku-5-5</code>. Empty uses {DEFAULT_ANTHROPIC_MODEL}.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-medium">Model</p>
                  <div className="grid grid-cols-2 gap-2">
                    {MODEL_DEFINITIONS.filter((model) => model.providers.includes(provider)).map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => updateSettings((current) => ({ ...current, model: model.id }))}
                        className={`h-11 rounded-xl border px-3 text-sm font-medium transition ${
                          settings.model === model.id
                            ? "border-white bg-white text-black"
                            : "border-white/10 bg-[#212121] text-[#ececec] hover:border-white/25"
                        }`}
                        title={
                          model.nvidiaExperimental ? "Experimental: not currently listed in NVIDIA NIM catalog" : model.label
                        }
                      >
                        {model.label}
                        {model.nvidiaExperimental ? " *" : ""}
                      </button>
                    ))}
                  </div>
                  {activeCustomModel ? (
                    <p className="mt-1.5 text-xs text-amber-200">
                      Overridden by the custom model ID below ({activeCustomModel}).
                    </p>
                  ) : provider === "nvidia" ? (
                    <p className="mt-1.5 text-xs text-[#8f8f8f]">
                      * Experimental models may fail if NVIDIA NIM has not enabled them for your account.
                    </p>
                  ) : null}
                </div>
              )}

              <details className="group rounded-2xl border border-white/10 bg-[#212121]/60 px-4 py-3" open={Boolean(activeBaseUrl || (!isClaude && activeCustomModel))}>
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
                  Advanced
                  <ChevronRight size={16} className="text-[#8f8f8f] transition-transform group-open:rotate-90" />
                </summary>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm" htmlFor="baseUrl">
                      Custom endpoint
                    </label>
                    <input
                      id="baseUrl"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      value={activeBaseUrl}
                      onChange={(event) =>
                        updateSettings((current) => ({ ...current, [baseUrlKey]: event.target.value }))
                      }
                      placeholder={DEFAULT_ENDPOINTS[provider]}
                      className={fieldClass}
                    />
                    <p className="mt-1.5 text-xs leading-5 text-[#8f8f8f]">
                      {isClaude ? (
                        <>
                          For a Claude-compatible gateway or proxy. Paste its base URL;{" "}
                          <code className="text-[#c8c8c8]">/v1/messages</code> is added automatically.
                        </>
                      ) : (
                        <>
                          Any OpenAI-compatible URL. Paste a base like <code className="text-[#c8c8c8]">https://host/v1</code>{" "}
                          or the full <code className="text-[#c8c8c8]">/chat/completions</code> path.
                        </>
                      )}{" "}
                      Leave empty for the default. The key above is sent to whichever endpoint is set here.
                    </p>
                  </div>

                  {!isClaude ? (
                    <div>
                      <label className="mb-2 block text-sm" htmlFor="customModel">
                        Custom model ID
                      </label>
                      <input
                        id="customModel"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={activeCustomModel}
                        onChange={(event) =>
                          updateSettings((current) => ({ ...current, [customModelKey]: event.target.value }))
                        }
                        placeholder={provider === "nvidia" ? "deepseek-ai/deepseek-v4-flash" : "deepseek-chat"}
                        className={fieldClass}
                      />
                      <p className="mt-1.5 text-xs text-[#8f8f8f]">
                        Sent instead of the model picked above, for endpoints that name models differently.
                      </p>
                    </div>
                  ) : null}
                </div>
              </details>

              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="instructions">
                  Custom instructions
                </label>
                <textarea
                  id="instructions"
                  value={settings.instructions}
                  onChange={(event) => updateSettings((current) => ({ ...current, instructions: event.target.value }))}
                  rows={5}
                  className="w-full resize-none rounded-xl border border-white/10 bg-[#212121] px-3 py-3 text-sm leading-6 text-[#ececec] outline-none transition focus:border-white/25"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium transition hover:bg-white/[0.06]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/85"
              >
                Save
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
