import { useCallback, useEffect, useRef, useState } from "react";
import { AiRequestError, callAi } from "./api";
import type { AiEnvelope, AiFeatureName, AiInput } from "../../shared/contracts";

export type AiState<F extends AiFeatureName> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; envelope: AiEnvelope<F> }
  | { status: "error"; message: string };

/**
 * Run one AI feature. A newer request cancels an older one, and leaving the
 * screen cancels whatever is running, so a slow answer can never overwrite newer
 * state or update an unmounted component.
 */
export function useAi<F extends AiFeatureName>(feature: F) {
  const [state, setState] = useState<AiState<F>>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (input: AiInput<F>): Promise<AiEnvelope<F> | null> => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setState({ status: "loading" });
      try {
        const envelope = await callAi(feature, input, current.signal);
        // A response can land just as the request is cancelled. It is stale either way.
        if (current.signal.aborted) return null;
        setState({ status: "success", envelope });
        return envelope;
      } catch (error) {
        if (current.signal.aborted) return null;
        const message =
          error instanceof AiRequestError
            ? error.message
            : "Something went wrong. Please try again.";
        setState({ status: "error", message });
        return null;
      }
    },
    [feature],
  );

  return { state, run };
}
