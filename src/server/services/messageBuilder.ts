/**
 * MessageBuilder Service
 *
 * Converts Hooks data (tool usage) into Message format for frontend display.
 * Each tool usage is converted into a user-friendly message with structured metadata.
 */

interface HookToolUseData {
  sessionId: string;
  toolName: string;
  toolInput: any;
  toolOutput?: any;
}

interface MessageContent {
  role: "assistant";
  content: string;
  toolUsages?: Array<{
    name: string;
    input: any;
    output: any;
  }>;
}

/**
 * Convert PostToolUse hook data to Message format
 */
export const buildMessageFromToolUse = (
  data: HookToolUseData,
): MessageContent => {
  const { toolName, toolInput, toolOutput } = data;

  let content = "";

  // Generate user-friendly message based on tool type
  switch (toolName) {
    case "Write":
      content = `Write ${toolInput.file_path || ""}`;
      break;

    case "Edit":
      content = `Edit ${toolInput.file_path || ""}`;
      break;

    case "Bash":
      content = `Bash ${toolInput.command || ""}`;
      break;

    case "Read":
      content = `Read ${toolInput.file_path || ""}`;
      break;

    case "Grep":
      content = `Grep ${toolInput.pattern || ""}`;
      break;

    case "Glob":
      content = `Glob ${toolInput.pattern || ""}`;
      break;

    case "AskUserQuestion":
      content = `AskUserQuestion`;
      break;

    default:
      content = `${toolName}`;
      break;
  }

  return {
    role: "assistant",
    content,
    toolUsages: [
      {
        name: toolName,
        input: toolInput || {},
        output: toolOutput || {},
      },
    ],
  };
};

/**
 * Convert text response to Message format
 */
export const buildMessageFromText = (text: string): MessageContent => {
  return {
    role: "assistant",
    content: text,
  };
};

/**
 * Batch convert multiple tool usages into a single message
 * (for cases where multiple tools are used in sequence)
 */
export const buildMessageFromMultipleToolUses = (
  toolUses: HookToolUseData[],
): MessageContent => {
  if (toolUses.length === 0) {
    return {
      role: "assistant",
      content: "No tools used",
    };
  }

  if (toolUses.length === 1) {
    return buildMessageFromToolUse(toolUses[0]);
  }

  // Multiple tools: create summary
  const toolNames = toolUses.map((t) => t.toolName);
  const uniqueTools = [...new Set(toolNames)];

  const content = `Used ${uniqueTools.length} tools: ${uniqueTools.join(", ")}`;

  return {
    role: "assistant",
    content,
    toolUsages: toolUses.map((t) => ({
      name: t.toolName,
      input: t.toolInput || {},
      output: t.toolOutput || {},
    })),
  };
};
