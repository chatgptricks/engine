import type {ChatCard, ChatMessage, ChatPart} from "./threads";

/**
 * The browser side of the chat's event stream (app/api/engine/assistant):
 * reading `data: {json}` events off the response, and folding them into the
 * answer being shown while it's written. Client-safe.
 */

export type ChatToolPart = Extract<ChatPart, {type: "tool"}>;
export type ChatStreamEvent =
  | {type: "queued"; position: number}
  | {type: "message"; message: ChatMessage}
  | {type: "reply"; message: ChatMessage}
  | {type: "text"; delta: string}
  | {type: "note"; text: string}
  | {type: "tool"; part: ChatToolPart}
  | {type: "card"; card: ChatCard}
  | {type: "deck_ops"; id: string; operations: unknown[]; changes: string[]}
  | {type: "open"; deckId: string}
  | {type: "done"; message: ChatMessage}
  | {type: "error"; error: string; message?: ChatMessage};

/** Calls `onEvent` for each event, however the bytes are split. Comments (keep-alives) and broken lines are skipped. */
export async function readChatEvents(body: ReadableStream<Uint8Array>, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const flush = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let event: ChatStreamEvent | null = null;
      try { event = JSON.parse(line.slice(6)) as ChatStreamEvent; } catch { event = null; }
      if (event && typeof event === "object" && typeof event.type === "string") onEvent(event);
    }
  };
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      flush(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}

/** Adds or replaces a message by id. */
export const upsertMessage = (messages: ChatMessage[], message: ChatMessage) =>
  messages.some(item => item.id === message.id) ? messages.map(item => item.id === message.id ? message : item) : [...messages, message];

/** Swaps the message shown while sending (`localId`) for the one the server saved. */
export function settleMessage(messages: ChatMessage[], localId: string, message: ChatMessage): ChatMessage[] {
  if (messages.some(item => item.id === message.id)) return messages.filter(item => item.id !== localId);
  if (messages.some(item => item.id === localId)) return messages.map(item => item.id === localId ? message : item);
  return [...messages, message];
}

export type ChatStepPart = Extract<ChatPart, {type: "tool" | "note"}>;
/** One piece of an answer as shown. `key` stays the same while the answer is written and once it's done. */
export type AnswerItem =
  | {kind: "text"; key: string; text: string; narration: boolean}
  | {kind: "step"; key: string; part: ChatStepPart}
  | {kind: "card"; key: string; card: ChatCard};

/**
 * An answer's parts as people read them. What Claude writes before its last
 * step says what it's doing ("Reading the post first."), so it's narration;
 * what it writes after its last step is the answer. Consecutive text (web
 * results arrive in pieces) reads as one.
 */
export function answerItems(parts: ChatPart[]): AnswerItem[] {
  let lastStep = -1;
  parts.forEach((part, index) => { if (part.type === "tool" || part.type === "note") lastStep = index; });
  const items: AnswerItem[] = [];
  parts.forEach((part, index) => {
    const key = `part-${index}`;
    if (part.type === "text") {
      const previous = items[items.length - 1], narration = index < lastStep;
      if (previous?.kind === "text" && previous.narration === narration) previous.text += part.text;
      else items.push({kind: "text", key, text: part.text, narration});
    } else if (part.type === "card") items.push({kind: "card", key, card: part.card});
    else items.push({kind: "step", key, part});
  });
  return items.filter(item => item.kind !== "text" || item.text.trim());
}

/**
 * A finished answer: the steps and narration fold away, and the cards and the
 * answer stay. An answer that ended on a step, with nothing written after it,
 * keeps its last words in view.
 */
export function foldAnswer(message: ChatMessage): {folded: AnswerItem[]; shown: AnswerItem[]} {
  const items = answerItems(message.parts ?? []);
  let folded = items.filter(item => item.kind === "step" || (item.kind === "text" && item.narration));
  const shown = items.filter(item => item.kind === "card" || (item.kind === "text" && !item.narration));
  const lastWords = [...folded].reverse().find(item => item.kind === "text");
  if (message.status === "done" && lastWords && !shown.some(item => item.kind === "text")) {
    folded = folded.filter(item => item !== lastWords);
    shown.push({...lastWords, narration: false});
  }
  return {folded, shown};
}

/** What a running answer is doing right now: the step under way, writing, or thinking. */
export function activityOf(parts: ChatPart[]): string {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part.type === "tool" && part.status === "running") return part.label;
  }
  const last = parts[parts.length - 1];
  return last?.type === "text" && last.text.trim() ? "Writing" : "Thinking";
}

/** A length of time the way people say it: "8s", "1m 5s", "12m", "1h 3m". */
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 10) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Folds a live event into the answer being written, the way the server builds its parts. */
export function withChatEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  const parts = [...(message.parts ?? [])];
  if (event.type === "text") {
    const last = parts[parts.length - 1];
    if (last?.type === "text") parts[parts.length - 1] = {...last, text: last.text + event.delta};
    else parts.push({type: "text", text: event.delta});
  } else if (event.type === "note") parts.push({type: "note", text: event.text});
  else if (event.type === "tool") {
    const index = parts.findIndex(part => part.type === "tool" && part.id === event.part.id);
    if (index >= 0) parts[index] = event.part;
    else parts.push(event.part);
  } else if (event.type === "card") parts.push({type: "card", card: event.card});
  else return message;
  return {...message, parts};
}
