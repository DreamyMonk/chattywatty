import Anthropic from "@anthropic-ai/sdk";
import { isAuthenticated } from "@/lib/auth";
import {
  DEFAULT_ANTHROPIC_MODEL,
  PROVIDER_LABELS,
  getModelDefinition,
  resolveAnthropicBaseUrl,
  resolveEndpoint,
  sanitizeCustomModel,
} from "@/lib/models";
import { apiKeyForProvider, readStore, writeStore, type Chat, type Message, type StoreState } from "@/lib/store";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatRequest = {
  chatId?: string;
  title?: string;
  userMessage?: Message;
  assistantMessage?: Message;
  messages?: ChatMessage[];
};

const THINKING_START = "[[CHATMIO_THINKING_START]]";
const THINKING_END = "[[CHATMIO_THINKING_END]]";
const PRO_MODEL = "deepseek-v4-pro";
const FLASH_MODEL = "deepseek-v4-flash";
const NVIDIA_FLASH_MODEL = "deepseek-ai/deepseek-v4-flash";

export const runtime = "nodejs";

function titleFromPrompt(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 38 ? `${cleaned.slice(0, 38)}...` : cleaned;
}

function upsertChatMessages(
  store: StoreState,
  chatId: string,
  title: string | undefined,
  userMessage: Message | undefined,
  assistantMessage: Message | undefined,
  assistantContent: string,
) {
  const now = Date.now();
  const existingChat = store.chats.find((chat) => chat.id === chatId);
  const baseChat: Chat =
    existingChat ??
    ({
      id: chatId,
      title: title || titleFromPrompt(userMessage?.content ?? ""),
      messages: [],
      createdAt: now,
      updatedAt: now,
    } satisfies Chat);

  const nextMessages = [...baseChat.messages];

  if (userMessage && !nextMessages.some((message) => message.id === userMessage.id)) {
    nextMessages.push(userMessage);
  }

  if (assistantMessage) {
    const existingAssistantIndex = nextMessages.findIndex((message) => message.id === assistantMessage.id);
    const nextAssistantMessage = {
      ...assistantMessage,
      content: assistantContent,
    };

    if (existingAssistantIndex >= 0) {
      nextMessages[existingAssistantIndex] = nextAssistantMessage;
    } else {
      nextMessages.push(nextAssistantMessage);
    }
  }

  const nextChat: Chat = {
    ...baseChat,
    title: baseChat.title === "New chat" && userMessage?.content ? titleFromPrompt(userMessage.content) : baseChat.title,
    messages: nextMessages,
    updatedAt: now,
  };

  return {
    ...store,
    chats: existingChat
      ? store.chats.map((chat) => (chat.id === chatId ? nextChat : chat))
      : [nextChat, ...store.chats],
  };
}

async function persistAssistantMessage(
  chatId: string | undefined,
  title: string | undefined,
  userMessage: Message | undefined,
  assistantMessage: Message | undefined,
  assistantContent: string,
) {
  if (!chatId || !userMessage || !assistantMessage) return;

  const latestStore = await readStore();
  await writeStore(upsertChatMessages(latestStore, chatId, title, userMessage, assistantMessage, assistantContent));
}

function retryAfterSeconds(response: Response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(1, Math.ceil((retryDate - Date.now()) / 1000));
  }

  return undefined;
}

/** Saved replies embed reasoning between markers; never send that back to a model as history. */
function stripThinking(content: string) {
  const start = content.indexOf(THINKING_START);
  if (start === -1) return content;
  const end = content.indexOf(THINKING_END, start);
  return `${content.slice(0, start)}${end === -1 ? "" : content.slice(end + THINKING_END.length)}`.trim();
}

function claudeErrorMessage(error: unknown, model: string) {
  if (error instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check it in Settings.";
  if (error instanceof Anthropic.PermissionDeniedError) return `This API key does not have access to "${model}".`;
  if (error instanceof Anthropic.NotFoundError) {
    return `Model "${model}" was not found. Check the Claude model name in Settings.`;
  }
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate limited right now. Wait a moment and try again.";
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Claude API. Check your network or the custom endpoint URL.";
  }
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ""}: ${error.message}`;
  return "The Claude request failed before returning a response.";
}

function proRateLimitMessage(providerLabel: string, response: Response) {
  const retryAfter = retryAfterSeconds(response);
  const waitText = retryAfter ? ` Wait about ${retryAfter} seconds, then try Pro again.` : "";
  return `Error: DeepSeek V4 Pro is rate limited on ${providerLabel} right now.${waitText} Use V4 Flash for this reply, or try Pro again later.`;
}

export async function POST(request: Request) {
  try {
    if (!(await isAuthenticated())) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json()) as ChatRequest;
    const store = await readStore();

    const provider = store.settings.provider;
    const customEndpoint = {
      official: store.settings.officialBaseUrl,
      nvidia: store.settings.nvidiaBaseUrl,
      anthropic: store.settings.anthropicBaseUrl,
    }[provider];
    const endpoint = resolveEndpoint(provider, customEndpoint);
    const customModel = sanitizeCustomModel(
      {
        official: store.settings.officialCustomModel,
        nvidia: store.settings.nvidiaCustomModel,
        anthropic: store.settings.anthropicCustomModel,
      }[provider],
    );
    const modelDefinition = getModelDefinition(store.settings.model);
    const providerModelId =
      customModel ||
      (provider === "anthropic"
        ? DEFAULT_ANTHROPIC_MODEL
        : provider === "nvidia"
          ? modelDefinition?.nvidiaModelId
          : store.settings.model);
    // A custom model id bypasses the catalog, so the Pro rate-limit fallback no longer applies.
    const canFallbackToFlash = !customModel && store.settings.model === PRO_MODEL;
    const apiKey = apiKeyForProvider(store.settings).trim();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const chatId = body.chatId?.trim();
    const userMessage = body.userMessage?.role === "user" ? body.userMessage : undefined;
    const assistantMessage = body.assistantMessage?.role === "assistant" ? body.assistantMessage : undefined;

    if (!apiKey) {
      return Response.json(
        { error: `Add your ${PROVIDER_LABELS[provider]} API key in Settings first.` },
        { status: 400 },
      );
    }

    if (!providerModelId) {
      return Response.json(
        { error: `Model ${store.settings.model} is not available for ${PROVIDER_LABELS[provider]}.` },
        { status: 400 },
      );
    }

    if (chatId && userMessage && assistantMessage) {
      await writeStore(upsertChatMessages(store, chatId, body.title, userMessage, assistantMessage, ""));
    }

    const preparedMessages: ChatMessage[] = [
      {
        role: "system",
        content:
          store.settings.instructions.trim() ||
          "You are Chatmio, a concise and helpful personal AI assistant.",
      },
      ...messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => {
          const content = String(message.content ?? "");
          return { role: message.role, content: message.role === "assistant" ? stripThinking(content) : content };
        })
        .filter((message) => message.content.trim()),
    ];

    if (provider === "anthropic") {
      const encoder = new TextEncoder();
      const client = new Anthropic({ apiKey, baseURL: resolveAnthropicBaseUrl(customEndpoint), maxRetries: 1 });
      const claudeMessages: Anthropic.MessageParam[] = preparedMessages.flatMap(({ role, content }) =>
        role === "system" ? [] : [{ role, content }],
      );
      // Older Claude models reject adaptive thinking or a 64K output cap, so a 400 before any
      // output retries once as a plain request.
      const attempts: Array<Pick<Anthropic.MessageStreamParams, "max_tokens" | "thinking">> = [
        { max_tokens: 64000, thinking: { type: "adaptive", display: "summarized" } },
        { max_tokens: 8192 },
      ];
      let lastWrite = 0;

      const stream = new ReadableStream({
        async start(controller) {
          let assistantContent = "";
          let isReasoning = false;

          const emit = async (token: string) => {
            assistantContent += token;
            try {
              controller.enqueue(encoder.encode(token));
            } catch {
              // The browser went away; keep persisting so the reply is not lost.
            }
            const now = Date.now();
            if (now - lastWrite < 900) return;
            lastWrite = now;
            await persistAssistantMessage(chatId, body.title, userMessage, assistantMessage, assistantContent);
          };

          for (let attempt = 0; attempt < attempts.length; attempt++) {
            try {
              const claudeStream = client.messages.stream(
                {
                  model: providerModelId,
                  system: preparedMessages[0].content,
                  messages: claudeMessages,
                  ...attempts[attempt],
                },
                { signal: request.signal },
              );

              for await (const event of claudeStream) {
                if (event.type !== "content_block_delta") continue;

                if (event.delta.type === "thinking_delta" && event.delta.thinking) {
                  await emit(`${isReasoning ? "" : THINKING_START}${event.delta.thinking}`);
                  isReasoning = true;
                } else if (event.delta.type === "text_delta" && event.delta.text) {
                  await emit(`${isReasoning ? THINKING_END : ""}${event.delta.text}`);
                  isReasoning = false;
                }
              }

              const finalMessage = await claudeStream.finalMessage();
              if (isReasoning) {
                await emit(THINKING_END);
                isReasoning = false;
              }
              if (finalMessage.stop_reason === "refusal") {
                await emit("\n\n_Claude declined to answer this request._");
              } else if (finalMessage.stop_reason === "max_tokens") {
                await emit("\n\n_Response cut off at the max token limit._");
              }
              break;
            } catch (error) {
              if (error instanceof Anthropic.APIUserAbortError) break;
              if (error instanceof Anthropic.BadRequestError && !assistantContent && attempt < attempts.length - 1) {
                continue;
              }
              if (isReasoning) {
                await emit(THINKING_END);
                isReasoning = false;
              }
              await emit(`${assistantContent ? "\n\n" : ""}Error: ${claudeErrorMessage(error, providerModelId)}`);
              break;
            }
          }

          if (!assistantContent.trim() && !request.signal.aborted) {
            await emit("Error: Claude returned an empty response.");
          }
          await persistAssistantMessage(chatId, body.title, userMessage, assistantMessage, assistantContent);
          try {
            controller.close();
          } catch {
            // Already closed by a disconnect.
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    if (provider === "nvidia") {
      const isProModel = !customModel && store.settings.model === PRO_MODEL;
      const timeoutMs = isProModel ? 180000 : 90000;
      const maxTokens = isProModel ? 4096 : 2048;
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(streamController) {
          const requestController = new AbortController();
          const timeout = setTimeout(() => requestController.abort(), timeoutMs);
          let assistantContent = `${THINKING_START}Contacting ${customEndpoint ? "your custom NVIDIA-style endpoint" : "NVIDIA NIM"}.\n\nEndpoint: ${endpoint}\n\nModel: ${providerModelId}\n\nThis provider returns the model as one completed response, so Chatmio is waiting for the final answer and will type it out when it arrives.`;

          streamController.enqueue(encoder.encode(assistantContent));

          try {
            const requestNvidia = (model: string, tokens: number) =>
              fetch(endpoint, {
                method: "POST",
                signal: requestController.signal,
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model,
                  messages: preparedMessages,
                  temperature: 1,
                  top_p: 0.95,
                  max_tokens: tokens,
                  chat_template_kwargs: {
                    thinking: false,
                  },
                  stream: false,
                }),
              });

            let fallbackNotice = "";
            let nvidiaResponse = await requestNvidia(providerModelId, maxTokens);

            if (nvidiaResponse.status === 429 && canFallbackToFlash) {
              const note =
                "\n\nDeepSeek V4 Pro is rate limited on NVIDIA NIM. I am switching this reply to V4 Flash automatically.";
              assistantContent += note;
              streamController.enqueue(encoder.encode(note));
              fallbackNotice =
                "DeepSeek V4 Pro is rate limited right now, so I used V4 Flash for this reply.\n\n";
              nvidiaResponse = await requestNvidia(NVIDIA_FLASH_MODEL, 2048);
            }

            if (!nvidiaResponse.ok) {
              const message =
                nvidiaResponse.status === 429 && canFallbackToFlash
                  ? proRateLimitMessage("NVIDIA NIM", nvidiaResponse)
                  : `Error: ${(await nvidiaResponse.text()) || "NVIDIA NIM did not return a usable response."}`;
              assistantContent += `${THINKING_END}${message}`;
              streamController.enqueue(encoder.encode(`${THINKING_END}${message}`));
              await persistAssistantMessage(chatId, body.title, userMessage, assistantMessage, assistantContent);
              streamController.close();
              return;
            }

            const payload = (await nvidiaResponse.json()) as {
              choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
            };
            const nvidiaMessage = payload.choices?.[0]?.message;
            const nvidiaThinking = payload.choices?.[0]?.message?.reasoning_content?.trim();
            const nvidiaAnswer =
              nvidiaMessage?.content?.trim() ||
              "Error: NVIDIA NIM returned an empty response. Check that this model is available for your NVIDIA API key.";
            const answerText = `${nvidiaThinking ? `\n\nProvider reasoning:\n${nvidiaThinking}` : ""}${THINKING_END}${fallbackNotice}${nvidiaAnswer}`;

            assistantContent += answerText;
            streamController.enqueue(encoder.encode(answerText));
            await persistAssistantMessage(chatId, body.title, userMessage, assistantMessage, assistantContent);
            streamController.close();
          } catch (error) {
            const message =
              error instanceof Error && error.name === "AbortError"
                ? `Error: NVIDIA NIM ${isProModel ? "Pro" : "Flash"} timed out after ${Math.round(timeoutMs / 1000)} seconds.`
                : "Error: NVIDIA NIM request failed before returning a response.";

            assistantContent += `${THINKING_END}${message}`;
            streamController.enqueue(encoder.encode(`${THINKING_END}${message}`));
            await persistAssistantMessage(chatId, body.title, userMessage, assistantMessage, assistantContent);
            streamController.close();
          } finally {
            clearTimeout(timeout);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    const requestOfficial = (model: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: preparedMessages,
          stream: true,
          temperature: 0.7,
        }),
      });

    let fallbackNotice = "";
    let deepseekResponse = await requestOfficial(providerModelId);

    if (deepseekResponse.status === 429 && canFallbackToFlash) {
      fallbackNotice = "DeepSeek V4 Pro is rate limited right now, so I used V4 Flash for this reply.\n\n";
      deepseekResponse = await requestOfficial(FLASH_MODEL);
    }

    if (!deepseekResponse.ok || !deepseekResponse.body) {
      const errorText =
        deepseekResponse.status === 429 && canFallbackToFlash
          ? proRateLimitMessage("DeepSeek official", deepseekResponse)
          : await deepseekResponse.text();
      return Response.json(
        { error: errorText || "DeepSeek did not return a usable response." },
        { status: deepseekResponse.status || 502 },
      );
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    let assistantContent = "";
    let lastWrite = 0;
    let isReasoning = false;

    const persistAssistant = async (force = false) => {
      if (!chatId || !userMessage || !assistantMessage) return;
      const now = Date.now();
      if (!force && now - lastWrite < 900) return;

      lastWrite = now;
      const latestStore = await readStore();
      await writeStore(
        upsertChatMessages(latestStore, chatId, body.title, userMessage, assistantMessage, assistantContent),
      );
    };

    const stream = new ReadableStream({
      async start(controller) {
        const reader = deepseekResponse.body!.getReader();

        try {
          if (fallbackNotice) {
            assistantContent += fallbackNotice;
            controller.enqueue(encoder.encode(fallbackNotice));
            await persistAssistant();
          }

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data) as {
                  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
                };
                const delta = parsed.choices?.[0]?.delta;
                const reasoningToken = delta?.reasoning_content;
                const answerToken = delta?.content;

                if (reasoningToken) {
                  const token = `${isReasoning ? "" : THINKING_START}${reasoningToken}`;
                  isReasoning = true;
                  assistantContent += token;
                  controller.enqueue(encoder.encode(token));
                  await persistAssistant();
                }

                if (answerToken) {
                  const token = `${isReasoning ? THINKING_END : ""}${answerToken}`;
                  isReasoning = false;
                  assistantContent += token;
                  controller.enqueue(encoder.encode(token));
                  await persistAssistant();
                }
              } catch {
                // Ignore malformed stream events and continue reading.
              }
            }
          }
        } catch (error) {
          controller.error(error);
          return;
        }

        if (isReasoning) {
          assistantContent += THINKING_END;
          controller.enqueue(encoder.encode(THINKING_END));
        }

        if (!assistantContent.trim()) {
          assistantContent = "Error: The provider returned an empty response.";
          controller.enqueue(encoder.encode(assistantContent));
        }

        await persistAssistant(true);
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return Response.json({ error: "The chat request could not be processed." }, { status: 500 });
  }
}
