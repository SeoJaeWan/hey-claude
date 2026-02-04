export interface AutocompleteItem {
    id: string;
    trigger: string;
    name: string;
    type: "command" | "snippet";
    value: string;
}

type TranslationFunction = (key: string) => string;

// Get commands with translated names
export const getCommands = (t: TranslationFunction): AutocompleteItem[] => [
    {id: "cmd-1", trigger: "/help", name: t("commands.help"), type: "command", value: "/help"},
    {id: "cmd-2", trigger: "/clear", name: t("commands.clear"), type: "command", value: "/clear"},
    {id: "cmd-3", trigger: "/new", name: t("commands.new"), type: "command", value: "/new"},
    {id: "cmd-4", trigger: "/summary", name: t("commands.summary"), type: "command", value: "/summary"},
    {id: "cmd-5", trigger: "/settings", name: t("commands.settings"), type: "command", value: "/settings"}
];

// Get snippets with translated names
export const getSnippets = (t: TranslationFunction): AutocompleteItem[] => [
    {
        id: "snip-1",
        trigger: "@react",
        name: t("snippets.reactTemplate"),
        type: "snippet",
        value: '```tsx\nimport React from "react";\n\nconst Component = () => {\n  return <div></div>;\n};\n\nexport default Component;\n```'
    },
    {
        id: "snip-2",
        trigger: "@typescript",
        name: t("snippets.tsInterface"),
        type: "snippet",
        value: "```typescript\ninterface Props {\n  \n}\n```"
    },
    {
        id: "snip-3",
        trigger: "@test",
        name: t("snippets.testTemplate"),
        type: "snippet",
        value: '```typescript\ndescribe("", () => {\n  it("should ", () => {\n    expect().toBe();\n  });\n});\n```'
    },
    {
        id: "snip-4",
        trigger: "@api",
        name: t("snippets.apiTemplate"),
        type: "snippet",
        value: '```typescript\nconst response = await fetch("/api/endpoint", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({}),\n});\nconst data = await response.json();\n```'
    },
    {
        id: "snip-5",
        trigger: "@style",
        name: t("snippets.tailwindStyle"),
        type: "snippet",
        value: 'className="flex items-center justify-between p-4 bg-white rounded-lg shadow"'
    }
];

// Backward compatibility - static exports (English defaults)
export const COMMANDS: AutocompleteItem[] = [
    {id: "cmd-1", trigger: "/help", name: "Show help", type: "command", value: "/help"},
    {id: "cmd-2", trigger: "/clear", name: "Clear conversation", type: "command", value: "/clear"},
    {id: "cmd-3", trigger: "/new", name: "Start new session", type: "command", value: "/new"},
    {id: "cmd-4", trigger: "/summary", name: "Context summary", type: "command", value: "/summary"},
    {id: "cmd-5", trigger: "/settings", name: "Open settings", type: "command", value: "/settings"}
];

export const SNIPPETS: AutocompleteItem[] = [
    {
        id: "snip-1",
        trigger: "@react",
        name: "React component template",
        type: "snippet",
        value: '```tsx\nimport React from "react";\n\nconst Component = () => {\n  return <div></div>;\n};\n\nexport default Component;\n```'
    },
    {
        id: "snip-2",
        trigger: "@typescript",
        name: "TypeScript interface",
        type: "snippet",
        value: "```typescript\ninterface Props {\n  \n}\n```"
    },
    {
        id: "snip-3",
        trigger: "@test",
        name: "Test code template",
        type: "snippet",
        value: '```typescript\ndescribe("", () => {\n  it("should ", () => {\n    expect().toBe();\n  });\n});\n```'
    },
    {
        id: "snip-4",
        trigger: "@api",
        name: "API request template",
        type: "snippet",
        value: '```typescript\nconst response = await fetch("/api/endpoint", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({}),\n});\nconst data = await response.json();\n```'
    },
    {
        id: "snip-5",
        trigger: "@style",
        name: "Tailwind style example",
        type: "snippet",
        value: 'className="flex items-center justify-between p-4 bg-white rounded-lg shadow"'
    }
];
