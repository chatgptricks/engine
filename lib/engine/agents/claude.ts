/**
 * Claude plumbing shared by the Recreate agents: one client, a model per role
 * (ENGINE_MODEL_<ROLE> overrides it), the server-side refusal fallback, answers
 * checked against a Zod schema, and a tool loop that resumes paused server-tool
 * turns and ends when the agent hands in its result with a `submit_*` tool.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export class RecreateError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function isRecreateConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

/**
 * The current team's roles (source, research, brief, headline, designer and
 * the two critics), then the first team's, kept for its modules until the cleanup.
 */
export type AgentRole = "source" | "research" | "brief" | "headline" | "designer" | "factCritic" | "designCritic"
  | "transcript" | "editor" | "facts" | "data" | "reactions" | "visuals" | "story" | "hooks" | "copy" | "art";
const OPUS = "claude-opus-5-5", SONNET = "claude-sonnet-5-5";
const DEFAULT_MODEL: Record<AgentRole, string> = {
  source: OPUS, research: OPUS, brief: OPUS, headline: SONNET, designer: OPUS, factCritic: OPUS, designCritic: OPUS,
  transcript: OPUS, editor: OPUS, facts: OPUS, data: SONNET, reactions: SONNET, visuals: SONNET, story: OPUS, hooks: SONNET, copy: OPUS, art: SONNET,
};
const ENV_NAME: Record<AgentRole, string> = {
  source: "SOURCE", research: "RESEARCH", brief: "BRIEF", headline: "HEADLINE", designer: "DESIGNER", factCritic: "FACT_CRITIC", designCritic: "DESIGN_CRITIC",
  transcript: "TRANSCRIPT", editor: "EDITOR", facts: "FACTS", data: "DATA", reactions: "REACTIONS", visuals: "VISUALS", story: "STORY", hooks: "HOOKS", copy: "COPY", art: "ART",
};

/** The role's model: ENGINE_MODEL_<ROLE>, else the older ANTHROPIC_RECREATE_MODEL for Opus roles, else the default. */
export function modelFor(role: AgentRole): string {
  const own = process.env[`ENGINE_MODEL_${ENV_NAME[role]}`]?.trim();
  if (own) return own;
  const legacy = process.env.ANTHROPIC_RECREATE_MODEL?.trim();
  return legacy && DEFAULT_MODEL[role] === OPUS ? legacy : DEFAULT_MODEL[role];
}

// Server-side refusal fallback, routed by refusal category.
const BETAS = ["server-side-fallback-2026-07-01"];
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Content = string | Anthropic.Beta.BetaContentBlockParam[];
export type SourceImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

let shared: Anthropic | null = null;
function client(): Anthropic {
  if (!isRecreateConfigured()) throw new RecreateError("Recreate is not configured: add ANTHROPIC_API_KEY to the server environment.", 503);
  return shared ??= new Anthropic();
}

/** Tokens a stage used, saved on its record so the cost per post is visible. */
export class UsageMeter {
  inputTokens = 0;
  outputTokens = 0;
  models = new Set<string>();
  add(model: string, usage: Anthropic.Beta.BetaUsage | null | undefined) {
    this.models.add(model);
    if (!usage) return;
    this.inputTokens += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    this.outputTokens += usage.output_tokens ?? 0;
  }
  get used(): boolean { return this.models.size > 0; }
  toJSON() { return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; }
}

export const imageBlock = (image: SourceImage): Anthropic.Beta.BetaContentBlockParam =>
  ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
/** Role cards are long and the same on every call, so they are cached. */
const system = (text: string): Anthropic.Beta.BetaTextBlockParam[] => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

type Call = { role: AgentRole; system: string; content: Content; what: string; effort?: Effort; maxTokens?: number; signal?: AbortSignal; usage?: UsageMeter };

function failOn(response: Anthropic.Beta.BetaMessage, what: string) {
  if (response.stop_reason === "refusal") throw new RecreateError(`Claude declined to ${what}.`, 422);
  if (response.stop_reason === "max_tokens") throw new RecreateError(`Claude ran out of room to ${what}. Try again.`, 502);
}

/** One structured answer, checked against `schema`. */
export async function ask<T extends z.ZodType>(call: Call & { schema: T }): Promise<z.infer<T>> {
  const model = modelFor(call.role);
  const response = await client().beta.messages.stream({
    model, max_tokens: call.maxTokens ?? 32000, betas: BETAS, fallbacks: "default",
    thinking: { type: "adaptive" }, output_config: { effort: call.effort ?? "high", format: betaZodOutputFormat(call.schema) },
    system: system(call.system), messages: [{ role: "user", content: call.content }],
  }, { signal: call.signal }).finalMessage();
  call.usage?.add(model, response.usage);
  failOn(response, call.what);
  if (response.parsed_output === null || response.parsed_output === undefined) throw new RecreateError(`Claude's answer to ${call.what} couldn't be read. Try again.`, 502);
  return response.parsed_output as z.infer<T>;
}

export type ClientTool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  /** Returns the text the agent reads. Throw a ToolError for a message the agent should see. */
  run: (input: Record<string, unknown>) => Promise<string>;
};
/** An error the agent may read and recover from (a bad series id, an empty window). */
export class ToolError extends Error {}

const toolDefinition = (name: string, description: string, schema: z.ZodType): Anthropic.Beta.BetaTool =>
  ({ name, description, input_schema: z.toJSONSchema(schema, { reused: "ref" }) as Anthropic.Beta.BetaTool.InputSchema });
const issuesOf = (error: z.ZodError) => error.issues.slice(0, 6).map(issue => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");

/**
 * Runs an agent with tools until it hands in its result through `submit`.
 * Server tools (web search and fetch) run on Anthropic's side; client tools run
 * here. A result that fails the schema goes back to the agent to fix.
 */
export async function work<T extends z.ZodObject>(call: Call & {
  /** `check` may return a problem to send back (for example a chart whose data won't download). */
  submit: { name: string; description: string; schema: T; check?: (value: z.infer<T>) => Promise<string | null> };
  tools?: ClientTool[];
  serverTools?: Anthropic.Beta.BetaToolUnion[];
  maxTurns?: number;
}): Promise<z.infer<T>> {
  const model = modelFor(call.role), anthropic = client();
  const own = new Map((call.tools ?? []).map(tool => [tool.name, tool]));
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...(call.serverTools ?? []),
    ...(call.tools ?? []).map(tool => toolDefinition(tool.name, tool.description, tool.schema)),
    toolDefinition(call.submit.name, call.submit.description, call.submit.schema),
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: call.content }];
  let reminded = false;
  for (let turn = 0; turn < (call.maxTurns ?? 20); turn++) {
    const response = await anthropic.beta.messages.stream({
      model, max_tokens: call.maxTokens ?? 64000, betas: BETAS, fallbacks: "default",
      thinking: { type: "adaptive" }, output_config: { effort: call.effort ?? "high" },
      system: system(call.system), tools, messages,
    }, { signal: call.signal }).finalMessage();
    call.usage?.add(model, response.usage);
    failOn(response, call.what);
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const uses = response.content.flatMap(block => block.type === "tool_use" ? [block] : []);
    const handIn = uses.find(use => use.name === call.submit.name);
    if (handIn) {
      const parsed = call.submit.schema.safeParse(handIn.input);
      const problem = parsed.success ? await call.submit.check?.(parsed.data) ?? null : `Fix these fields: ${issuesOf(parsed.error)}`;
      if (parsed.success && !problem) return parsed.data;
      messages.push({ role: "user", content: uses.map((use): Anthropic.Beta.BetaToolResultBlockParam => ({
        type: "tool_result", tool_use_id: use.id, is_error: true,
        content: use === handIn ? `Not saved. ${problem} Then call ${call.submit.name} again.` : `Skipped: hand in your result with ${call.submit.name} first.`,
      })) });
      continue;
    }
    if (uses.length) {
      messages.push({ role: "user", content: await Promise.all(uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = own.get(use.name);
        if (!tool) return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `There is no tool named ${use.name}.` };
        const input = tool.schema.safeParse(use.input ?? {});
        if (!input.success) return { type: "tool_result", tool_use_id: use.id, is_error: true, content: `Invalid input: ${issuesOf(input.error)}` };
        try {
          return { type: "tool_result", tool_use_id: use.id, content: await tool.run(input.data as Record<string, unknown>) };
        } catch (error) {
          if (call.signal?.aborted) throw error;
          return { type: "tool_result", tool_use_id: use.id, is_error: true, content: error instanceof ToolError ? error.message : "That tool failed. Try another way." };
        }
      })) });
      continue;
    }
    // Finished talking without handing in: one reminder, then give up.
    if (reminded) throw new RecreateError(`Claude finished without a result when asked to ${call.what}. Try again.`, 502);
    reminded = true;
    messages.push({ role: "user", content: `Hand in your result now with ${call.submit.name}.` });
  }
  throw new RecreateError(`Claude took too many steps to ${call.what}. Try again with a simpler post.`, 504);
}
