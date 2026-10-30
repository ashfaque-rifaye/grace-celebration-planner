/**
 * The browser's only door to the server. Responses are validated against the
 * shared contract before the UI sees them, and the 429 fallback is treated as an
 * answer, because the server still sends something useful with it.
 */
import { z } from "zod";
import {
  aiContracts,
  aiEnvelopeMeta,
  type AiEnvelope,
  type AiFeatureName,
  type AiInput,
} from "../../shared/contracts";

export class AiRequestError extends Error {
  override readonly name = "AiRequestError";
}

export async function callAi<F extends AiFeatureName>(
  feature: F,
  input: AiInput<F>,
  signal?: AbortSignal,
): Promise<AiEnvelope<F>> {
  let response: Response;
  try {
    response = await fetch(`/api/ai/${feature}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiRequestError("Could not reach Grace. Check your connection and try again.");
  }

  if (!response.ok && response.status !== 429) {
    throw new AiRequestError(
      response.status === 400
        ? "Grace could not read that. Check the details and try again."
        : "Grace ran into a problem. Please try again.",
    );
  }

  const schema = aiEnvelopeMeta.extend({
    data: aiContracts[feature].output as unknown as z.ZodType<AiEnvelope<F>["data"]>,
  });
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new AiRequestError("Grace sent an unexpected reply. Please try again.");
  return parsed.data as AiEnvelope<F>;
}
