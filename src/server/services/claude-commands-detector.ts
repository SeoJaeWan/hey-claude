import { spawn } from "child_process";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

export interface CommandInfo {
    name: string; // "commit"
    trigger: string; // "/commit"
    description: string; // YAML frontmatter의 description
    source: "local" | "builtin";
    allowedTools?: string[];
}

/**
 * YAML frontmatter를 파싱합니다.
 */
const parseYamlFrontmatter = (
    content: string
): { description?: string; allowedTools?: string[] } => {
    // YAML frontmatter 추출 (--- 사이의 내용, \r?\n으로 CRLF/LF 모두 지원)
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) {
        return {};
    }

    const frontmatter = frontmatterMatch[1];
    const result: { description?: string; allowedTools?: string[] } = {};

    // description 추출 (줄바꿈 포함될 수 있음)
    const descriptionMatch = frontmatter.match(/description:\s*["']([^"']+)["']/s);
    if (descriptionMatch) {
        result.description = descriptionMatch[1];
    }

    // allowed-tools 추출
    const allowedToolsMatch = frontmatter.match(/allowed-tools:\s*(.+)/);
    if (allowedToolsMatch) {
        const tools = allowedToolsMatch[1]
            .split(",")
            .map((tool) => tool.trim())
            .filter((tool) => tool.length > 0);
        result.allowedTools = tools;
    }

    return result;
};

/**
 * 프로젝트 로컬 .claude/commands 스캔
 */
export const scanLocalCommands = async (projectPath: string): Promise<CommandInfo[]> => {
    const commands: CommandInfo[] = [];
    const commandsDir = join(projectPath, ".claude", "commands");

    try {
        const files = await readdir(commandsDir);
        const mdFiles = files.filter((file) => file.endsWith(".md"));

        for (const file of mdFiles) {
            try {
                const filePath = join(commandsDir, file);
                const content = await readFile(filePath, "utf-8");
                const { description, allowedTools } = parseYamlFrontmatter(content);

                // 파일명에서 명령어 이름 추출 (예: commit.md -> commit)
                const name = file.replace(".md", "");

                commands.push({
                    name,
                    trigger: `/${name}`,
                    description: description || `Custom command: ${name}`,
                    source: "local",
                    allowedTools,
                });
            } catch (err) {
                console.error(`Failed to parse command file ${file}:`, err);
                // 개별 파일 파싱 실패해도 계속 진행
            }
        }
    } catch (err) {
        // .claude/commands 폴더가 없으면 빈 배열 반환
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("Failed to scan local commands:", err);
        }
    }

    return commands;
};

/**
 * Claude CLI 빌트인 명령어 추출
 */
export const getBuiltinCommands = async (): Promise<string[]> => {
    return new Promise((resolve) => {
        const child = spawn("claude", ["-p", "init", "--output-format", "stream-json", "--verbose"], {
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
        });

        let firstLine = "";
        let resolved = false;

        child.stdout?.on("data", (data: Buffer) => {
            if (resolved) return;

            const text = data.toString();
            const lines = text.split("\n");

            for (const line of lines) {
                if (line.trim().startsWith("{")) {
                    firstLine = line.trim();
                    break;
                }
            }

            if (firstLine) {
                try {
                    const json = JSON.parse(firstLine);
                    const slashCommands = json.slash_commands;

                    if (Array.isArray(slashCommands)) {
                        resolved = true;
                        child.kill();
                        resolve(slashCommands);
                    }
                } catch {
                    // JSON 파싱 실패하면 계속 진행
                }
            }
        });

        child.on("error", () => {
            if (!resolved) {
                resolved = true;
                resolve([]);
            }
        });

        child.on("close", () => {
            if (!resolved) {
                resolved = true;
                resolve([]);
            }
        });

        // timeout 처리
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                child.kill();
                resolve([]);
            }
        }, 5000);
    });
};

/**
 * 통합 (로컬 우선)
 */
export const getAllCommands = async (projectPath: string): Promise<CommandInfo[]> => {
    // 병렬 실행
    const [localCommands, builtinCommandNames] = await Promise.all([
        scanLocalCommands(projectPath),
        getBuiltinCommands(),
    ]);

    // 로컬 명령어 이름 Set 생성 (중복 체크용)
    const localCommandNames = new Set(localCommands.map((cmd) => cmd.name));

    // 빌트인 명령어 추가 (로컬에 없는 것만)
    const builtinCommands: CommandInfo[] = builtinCommandNames
        .filter((name) => !localCommandNames.has(name))
        .map((name) => ({
            name,
            trigger: `/${name}`,
            description: `Builtin command: ${name}`,
            source: "builtin" as const,
        }));

    // 로컬 + 빌트인 합치기 (로컬 우선)
    return [...localCommands, ...builtinCommands];
};
