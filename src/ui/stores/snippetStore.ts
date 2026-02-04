import {create} from "zustand";
import {persist} from "zustand/middleware";
import {SNIPPETS} from "../data/autocomplete";

export interface Snippet {
    id: string;
    trigger: string; // @로 시작 (예: "@react")
    name: string; // 설명
    value: string; // 삽입될 텍스트
}

interface SnippetStore {
    snippets: Snippet[];
    addSnippet: (snippet: Omit<Snippet, "id">) => void;
    updateSnippet: (id: string, snippet: Partial<Omit<Snippet, "id">>) => void;
    deleteSnippet: (id: string) => void;
    resetToDefault: () => void;
}

export const useSnippetStore = create<SnippetStore>()(
    persist(
        (set) => ({
            snippets: SNIPPETS.map((s) => ({id: s.id, trigger: s.trigger, name: s.name, value: s.value})),

            addSnippet: (snippet) =>
                set((state) => ({
                    snippets: [...state.snippets, {...snippet, id: crypto.randomUUID()}]
                })),

            updateSnippet: (id, updates) =>
                set((state) => ({
                    snippets: state.snippets.map((s) => (s.id === id ? {...s, ...updates} : s))
                })),

            deleteSnippet: (id) =>
                set((state) => ({
                    snippets: state.snippets.filter((s) => s.id !== id)
                })),

            resetToDefault: () =>
                set({
                    snippets: SNIPPETS.map((s) => ({id: s.id, trigger: s.trigger, name: s.name, value: s.value}))
                })
        }),
        {name: "hey-claude-snippets"}
    )
);
