"use client";

import {
  Bot,
  KeyRound,
  LogOut,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { MODEL_DEFINITIONS, type ModelId, type ProviderId } from "@/lib/models";

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
  provider: ProviderId;
  model: ModelId;
  instructions: string;
};

const defaultSettings: SettingsState = {
  apiKey: "",
  apiKeySet: false,
  officialApiKeySet: false,
  nvidiaApiKeySet: false,
  provider: "official",
  model: "deepseek-v4-flash",
  instructions: "You are Chatmio, my private assistant. Be clear, useful, and direct.",
};

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

function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
        code: ({ children }) => (
          <code className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[0.85em]">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-xl bg-black/35 p-3 font-mono text-xs last:mb-0">
            {children}
          </pre>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/8 text-white transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
    >
      {children}
    </button>
  );
}

function MessageBubble({ message, isPending }: { message: Message; isPending?: boolean }) {
  const isUser = message.role === "user";
  const { thinking, answer } = splitThinkingContent(message.content);

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[78%] ${
          isUser
            ? "rounded-br-md bg-emerald-400 text-stone-950"
            : "rounded-bl-md border border-white/10 bg-white/[0.07] text-zinc-100"
        }`}
      >
        {!message.content.trim() ? (
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
            <span>{isPending ? "Thinking..." : "No response saved."}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {thinking.trim() ? (
              <details className="rounded-xl border border-emerald-300/20 bg-emerald-300/8 p-3" open={isPending}>
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-emerald-200">
                  Thinking
                </summary>
                <div className="mt-3 max-h-80 overflow-y-auto text-xs leading-5 text-zinc-300">
                  <MarkdownBlock content={thinking} />
                </div>
              </details>
            ) : null}
            {answer.trim() ? <MarkdownBlock content={answer} /> : null}
            {!answer.trim() && isPending ? (
              <div className="flex items-center gap-2 text-zinc-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                <span>Composing answer...</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);
  const lastLocalChangeRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);

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
        settings?: Omit<SettingsState, "apiKey">;
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
      setSettings({
        apiKey: "",
        apiKeySet: data.settings?.apiKeySet ?? false,
        officialApiKeySet: data.settings?.officialApiKeySet ?? false,
        nvidiaApiKeySet: data.settings?.nvidiaApiKeySet ?? false,
        provider: data.settings?.provider ?? defaultSettings.provider,
        model: data.settings?.model ?? defaultSettings.model,
        instructions: data.settings?.instructions ?? defaultSettings.instructions,
      });
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
    async (nextChats: Chat[], nextSettings: SettingsState) => {
      pendingSyncRef.current = true;

      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chats: nextChats,
            settings: {
              apiKey: nextSettings.apiKey,
              provider: nextSettings.provider,
              model: nextSettings.model,
              instructions: nextSettings.instructions,
            },
          }),
        });

        if (!response.ok) throw new Error("Could not sync changes.");
        const data = (await response.json()) as {
          settings: Omit<SettingsState, "apiKey">;
        };
        setSettings((current) => ({
          ...current,
          apiKey: "",
          apiKeySet: data.settings.apiKeySet,
          officialApiKeySet: data.settings.officialApiKeySet,
          nvidiaApiKeySet: data.settings.nvidiaApiKeySet,
          provider: data.settings.provider,
          model: data.settings.model,
          instructions: data.settings.instructions,
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
    if (!authenticated || isStreaming || settingsOpen) return;

    const interval = setInterval(() => {
      loadState();
    }, 3000);

    return () => clearInterval(interval);
  }, [authenticated, isStreaming, loadState, settingsOpen]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChatId, chats]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? chats[0],
    [activeChatId, chats],
  );

  function updateActiveChat(updater: (chat: Chat) => Chat) {
    markLocalChange();
    setChats((currentChats) =>
      currentChats.map((chat) => (chat.id === activeChatId ? updater(chat) : chat)),
    );
  }

  function updateSettings(updater: (current: SettingsState) => SettingsState) {
    markLocalChange();
    setSettings(updater);
  }

  function startNewChat() {
    const chat = createChat();
    markLocalChange();
    setChats((currentChats) => {
      const nextChats = [chat, ...currentChats];
      saveState(nextChats, settings).catch(() => setError("Could not sync new chat."));
      return nextChats;
    });
    setActiveChatId(chat.id);
    setSidebarOpen(false);
    setError("");
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

  function renameChat(chatId: string) {
    const nextTitle = prompt("Rename chat");
    if (!nextTitle?.trim()) return;
    markLocalChange();
    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === chatId ? { ...chat, title: nextTitle.trim(), updatedAt: Date.now() } : chat,
      ),
    );
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
      await saveState(chats, settings);
      setSettingsOpen(false);
      setError("");
    } catch {
      setError("Could not save settings to the server.");
    }
  }

  function appendAssistantTextChunk(messageId: string, text: string) {
    updateActiveChat((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.id === messageId ? { ...message, content: message.content + text } : message,
      ),
      updatedAt: Date.now(),
    }));
  }

  async function appendAssistantText(messageId: string, text: string) {
    if (text.includes(THINKING_END) && text !== THINKING_END) {
      const endIndex = text.indexOf(THINKING_END);
      const markerPart = text.slice(0, endIndex + THINKING_END.length);
      const answerPart = text.slice(endIndex + THINKING_END.length);

      if (markerPart) {
        appendAssistantTextChunk(messageId, markerPart);
      }

      if (answerPart) {
        await appendAssistantText(messageId, answerPart);
      }

      return;
    }

    const pieces =
      text.length > 80 && !text.includes(THINKING_START) && !text.includes(THINKING_END)
        ? text.match(/[\s\S]{1,4}/g) ?? [text]
        : [text];

    for (const piece of pieces) {
      appendAssistantTextChunk(messageId, piece);

      if (pieces.length > 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 8));
      }
    }
  }

  function stopResponse() {
    chatAbortRef.current?.abort();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const promptText = input.trim();
    if (!promptText || !activeChat || isStreaming) return;

    if (!settings.apiKeySet && !settings.apiKey.trim()) {
      setSettingsOpen(true);
      setError("Add your DeepSeek API key before sending.");
      return;
    }

    if (settings.apiKey.trim()) {
      try {
        await saveState(chats, settings);
      } catch {
        setError("Could not save the API key before sending.");
        return;
      }
    }

    setError("");
    setInput("");
    setIsStreaming(true);

    const userMessage: Message = {
      id: newId(),
      role: "user",
      content: promptText,
      createdAt: Date.now(),
    };
    const assistantMessage: Message = {
      id: newId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };
    const requestController = new AbortController();
    chatAbortRef.current = requestController;
    activeAssistantIdRef.current = assistantMessage.id;

    const nextMessages = [...activeChat.messages, userMessage, assistantMessage];
    updateActiveChat((chat) => ({
      ...chat,
      title: chat.messages.length ? chat.title : titleFromPrompt(promptText),
      messages: nextMessages,
      updatedAt: Date.now(),
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: requestController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: activeChat.id,
          title: activeChat.messages.length ? chatDisplayTitle(activeChat) : titleFromPrompt(promptText),
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

        const chunk = decoder.decode(value, { stream: true });
        await appendAssistantText(assistantMessage.id, chunk);
      }
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") {
        await appendAssistantText(assistantMessage.id, "\n\n_Stopped._");
        return;
      }

      const message = sendError instanceof Error ? sendError.message : "Something went wrong.";
      setError(message);
      updateActiveChat((chat) => ({
        ...chat,
        messages: chat.messages.map((chatMessage) =>
          chatMessage.id === assistantMessage.id
            ? { ...chatMessage, content: `Error: ${message}` }
            : chatMessage,
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      if (activeAssistantIdRef.current === assistantMessage.id) {
        chatAbortRef.current = null;
        activeAssistantIdRef.current = null;
      }
      setIsStreaming(false);
    }
  }

  if (!hydrated) {
    return <main className="grid min-h-dvh place-items-center bg-zinc-950 text-zinc-100">Loading...</main>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#101113] px-5 text-zinc-100">
        <form
          onSubmit={login}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30"
        >
          <div className="mb-8 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-300 text-stone-950">
              <Bot size={23} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">Chatmio</h1>
              <p className="text-sm text-zinc-400">Private DeepSeek chat</p>
            </div>
          </div>
          <label className="mb-2 block text-sm text-zinc-300" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-zinc-100 outline-none ring-emerald-300/30 transition focus:ring-4"
            autoFocus
          />
          {error ? <p className="mt-3 text-sm text-amber-200">{error}</p> : null}
          {loginError ? <p className="mt-3 text-sm text-red-300">{loginError}</p> : null}
          <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 font-semibold text-stone-950 transition hover:bg-emerald-200">
            <KeyRound size={18} />
            Unlock
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh bg-[#101113] text-zinc-100">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[86vw] max-w-80 flex-col border-r border-white/10 bg-[#17181a] transition-transform duration-200 sm:static sm:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-white/10 p-3">
          <button
            type="button"
            onClick={startNewChat}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-3 text-sm font-semibold text-stone-950 transition hover:bg-emerald-200"
          >
            <MessageSquarePlus size={18} />
            New chat
          </button>
          <IconButton label="Close sidebar" onClick={() => setSidebarOpen(false)} className="sm:hidden">
            <X size={18} />
          </IconButton>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`mb-1 flex items-center gap-1 rounded-lg p-1 ${
                chat.id === activeChatId ? "bg-white/10" : "hover:bg-white/[0.06]"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveChatId(chat.id);
                  setSidebarOpen(false);
                }}
                className="min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm text-zinc-200"
              >
                {chatDisplayTitle(chat)}
              </button>
              <IconButton label="Rename chat" onClick={() => renameChat(chat.id)} className="h-8 w-8 border-0 bg-transparent">
                <PenLine size={15} />
              </IconButton>
              <IconButton label="Delete chat" onClick={() => deleteChat(chat.id)} className="h-8 w-8 border-0 bg-transparent">
                <Trash2 size={15} />
              </IconButton>
            </div>
          ))}
        </div>

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={logout}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm text-zinc-300 transition hover:bg-white/[0.06]"
          >
            <LogOut size={16} />
            Lock app
          </button>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-20 bg-black/55 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-2 border-b border-white/10 bg-[#101113]/95 px-3 backdrop-blur">
          <IconButton label="Open sidebar" onClick={() => setSidebarOpen(true)} className="sm:hidden">
            <Menu size={20} />
          </IconButton>
          <IconButton label="Toggle sidebar" onClick={() => setSidebarOpen((open) => !open)} className="hidden sm:grid">
            {sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}
          </IconButton>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{chatDisplayTitle(activeChat)}</p>
            <p className="truncate text-xs text-zinc-400">
              {settings.provider === "nvidia" ? "NVIDIA NIM" : "Official"} ·{" "}
              {MODEL_DEFINITIONS.find((model) => model.id === settings.model)?.label ?? settings.model}
            </p>
          </div>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings size={19} />
          </IconButton>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {!activeChat?.messages.length ? (
              <div className="pt-[14dvh] text-center">
                <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-300 text-stone-950">
                  <Sparkles size={26} />
                </div>
                <h1 className="text-3xl font-semibold">Chatmio</h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-400">
                  Start a private chat, choose Flash or Pro, and keep your custom instructions ready for every message.
                </p>
              </div>
            ) : (
              activeChat.messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isPending={
                    isStreaming &&
                    message.role === "assistant" &&
                    !message.content.trim() &&
                    index === activeChat.messages.length - 1
                  }
                />
              ))
            )}
            <div ref={scrollRef} />
          </div>
        </div>

        <form onSubmit={sendMessage} className="border-t border-white/10 bg-[#101113] p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
            {error ? <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
            <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/[0.07] p-2 shadow-2xl shadow-black/20">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Message Chatmio..."
                rows={1}
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              {isStreaming ? (
                <button
                  type="button"
                  aria-label="Stop response"
                  title="Stop response"
                  onClick={stopResponse}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-300 text-stone-950 transition hover:bg-red-200"
                >
                  <Square size={17} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="Send message"
                  title="Send message"
                  disabled={!input.trim()}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-300 text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send size={18} />
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      {settingsOpen ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 p-3 sm:items-center sm:justify-center">
          <section className="w-full rounded-2xl border border-white/10 bg-[#17181a] p-4 shadow-2xl sm:max-w-lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Settings</h2>
                <p className="text-sm text-zinc-400">DeepSeek key, model, and instructions</p>
              </div>
              <IconButton label="Close settings" onClick={() => setSettingsOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>

            <label className="mb-2 block text-sm text-zinc-300">API provider</label>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {([
                ["official", "Official"],
                ["nvidia", "NVIDIA NIM"],
              ] as const).map(([provider, label]) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() =>
                    updateSettings((current) => {
                      const nextModelIsValid = MODEL_DEFINITIONS.some(
                        (model) => model.id === current.model && model.providers.includes(provider),
                      );

                      return {
                        ...current,
                        apiKey: "",
                        apiKeySet:
                          provider === "nvidia" ? current.nvidiaApiKeySet : current.officialApiKeySet,
                        provider,
                        model: nextModelIsValid ? current.model : "deepseek-v4-flash",
                      };
                    })
                  }
                  className={`h-11 rounded-xl border px-3 text-sm font-medium transition ${
                    settings.provider === provider
                      ? "border-emerald-300 bg-emerald-300 text-stone-950"
                      : "border-white/10 bg-white/[0.06] text-zinc-200 hover:bg-white/10"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="mb-2 block text-sm text-zinc-300" htmlFor="apiKey">
              {settings.provider === "nvidia" ? "NVIDIA NIM API key" : "DeepSeek official API key"}
            </label>
            <input
              id="apiKey"
              type="password"
              value={settings.apiKey}
              onChange={(event) => updateSettings((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder={
                settings.apiKeySet
                  ? "Saved in Firebase. Type a new key to replace it."
                  : settings.provider === "nvidia"
                    ? "nvapi-..."
                    : "sk-..."
              }
              className="mb-4 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none ring-emerald-300/30 transition focus:ring-4"
            />
            {settings.apiKeySet ? (
              <p className="-mt-2 mb-4 text-xs text-emerald-200">
                {settings.provider === "nvidia" ? "NVIDIA NIM" : "DeepSeek official"} key is saved in Firebase.
              </p>
            ) : null}

            <label className="mb-2 block text-sm text-zinc-300">Model</label>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {MODEL_DEFINITIONS.filter((model) => model.providers.includes(settings.provider)).map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => updateSettings((current) => ({ ...current, model: model.id }))}
                  className={`h-11 rounded-xl border px-3 text-sm font-medium transition ${
                    settings.model === model.id
                      ? "border-emerald-300 bg-emerald-300 text-stone-950"
                      : "border-white/10 bg-white/[0.06] text-zinc-200 hover:bg-white/10"
                  }`}
                  title={model.nvidiaExperimental ? "Experimental: not currently listed in NVIDIA NIM catalog" : model.label}
                >
                  {model.label}
                  {model.nvidiaExperimental ? " *" : ""}
                </button>
              ))}
            </div>
            {settings.provider === "nvidia" ? (
              <p className="-mt-2 mb-4 text-xs text-zinc-400">
                * Experimental models may fail if NVIDIA NIM has not enabled them for your account.
              </p>
            ) : null}

            <label className="mb-2 block text-sm text-zinc-300" htmlFor="instructions">
              Custom instructions
            </label>
            <textarea
              id="instructions"
              value={settings.instructions}
              onChange={(event) => updateSettings((current) => ({ ...current, instructions: event.target.value }))}
              rows={6}
              className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 outline-none ring-emerald-300/30 transition focus:ring-4"
            />

            <button
              type="button"
              onClick={saveSettings}
              className="mt-4 h-11 w-full rounded-xl bg-emerald-300 font-semibold text-stone-950 transition hover:bg-emerald-200"
            >
              Save
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
