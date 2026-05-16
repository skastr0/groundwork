import {
  resolveSessionPromptContext,
  toSessionPromptContext,
  type FrameworkPromptContext,
  type FrameworkSessionKernelState,
} from "../kernel/index.ts";
import { logFrameworkEvent } from "../logger/index.ts";
import {
  SERVICE,
  type FrameworkPolicyRuntimeClient,
  type PolicyRuntimeState,
} from "./runtime-types.ts";

export async function injectPolicyPrompt(
  client: FrameworkPolicyRuntimeClient,
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
  sessionID: string,
  text: string,
): Promise<void> {
  const promptContext = await resolvePolicyPromptContext(client, state, runtimeState, sessionID);
  if (!promptContext) {
    await logFrameworkEvent(
      client,
      SERVICE,
      "warn",
      "Skipping policy prompt injection - missing session prompt context",
      {
        sessionID,
      },
    );
    return;
  }

  await client.session.prompt({
    path: { id: sessionID },
    body: {
      ...toSessionPromptContext(promptContext),
      noReply: true,
      parts: [
        {
          type: "text",
          text: `[groundwork:policy] ${text}`,
          synthetic: false,
        },
      ],
    },
  });
}

async function resolvePolicyPromptContext(
  client: FrameworkPolicyRuntimeClient,
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
  sessionID: string,
): Promise<FrameworkPromptContext | null> {
  if (state.promptContext) {
    runtimeState.promptContextLoaded = true;
    return state.promptContext;
  }

  if (runtimeState.promptContextLoaded) {
    return null;
  }

  runtimeState.promptContextLoaded = true;
  const promptContext = await resolveSessionPromptContext(client, sessionID, { limit: 10 });
  if (promptContext) {
    state.promptContext = promptContext;
  }

  return promptContext;
}
