/**
 * Runtime flag that selects which chat backend handles a request.
 *
 * `'ts'` — **default**. The in-process TypeScript runtime on `@openai/agents`
 * running against the app-wide LLM client (OpenRouter-first, OpenAI fallback)
 * via chat completions, with the realtor's workspace model, the full tool set,
 * approval gates, and the `delegate_task` orchestrator. No Modal cold start —
 * first token is fast. Deep / swarm work is spawned ON Modal from inside this
 * runtime via `delegate_task`; everyday chat never pays the sandbox tax.
 *
 * `'modal'` — opt-in (CHIPPI_CHAT_RUNTIME=modal). Proxies the WHOLE chat turn
 * to the Modal Python sandbox (MODAL_CHAT_URL). Preserved as a fallback / for
 * running heavy turns entirely in the sandbox, but NOT the default: routing
 * every turn through Modal is exactly the cold-start + dependency-on-deploy
 * failure that made the agent feel broken.
 *
 * Reads at call time so an env flip takes effect without a redeploy.
 */
export type ChatRuntime = 'modal' | 'ts';

export function chatRuntime(): ChatRuntime {
  const v = process.env.CHIPPI_CHAT_RUNTIME;
  return v === 'modal' ? 'modal' : 'ts';
}
