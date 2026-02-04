/**
 * Git 관련 기능
 */

import { spawn } from "child_process";

interface GitDiffResult {
    tracked: boolean;
    method: "clean" | "partial" | "none";
    modified: Array<{ path: string; additions: number; deletions: number }>;
    added: string[];
    deleted: string[];
    diff?: string;
    summary?: string;
}

interface GitStatus {
    branch: string;
    ahead: number;
    behind: number;
    modified: string[];
    added: string[];
    deleted: string[];
}

interface Commit {
    hash: string;
    author: string;
    date: string;
    message: string;
}

/**
 * 현재 브랜치 이름 조회
 */
export const getCurrentBranch = async (cwd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const git = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
        let output = "";
        let error = "";

        git.stdout.on("data", (data) => {
            output += data.toString();
        });

        git.stderr.on("data", (data) => {
            error += data.toString();
        });

        git.on("close", (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                reject(new Error(error || "Failed to get current branch"));
            }
        });
    });
};

/**
 * Git 상태 조회
 */
export const getGitStatus = async (cwd: string): Promise<GitStatus | null> => {
    try {
        const isGitRepo = await checkGitRepo(cwd);
        if (!isGitRepo) {
            return null;
        }

        const branch = await getCurrentBranch(cwd);
        const status = await execGit(["status", "--porcelain"], cwd);

        const modified: string[] = [];
        const added: string[] = [];
        const deleted: string[] = [];

        status.split("\n").forEach((line) => {
            if (!line.trim()) return;

            const statusCode = line.substring(0, 2);
            const filePath = line.substring(3);

            if (statusCode.includes("M")) {
                modified.push(filePath);
            } else if (statusCode.includes("A") || statusCode.includes("??")) {
                added.push(filePath);
            } else if (statusCode.includes("D")) {
                deleted.push(filePath);
            }
        });

        // ahead/behind 정보
        let ahead = 0;
        let behind = 0;

        try {
            const aheadBehind = await execGit(["rev-list", "--left-right", "--count", `@{upstream}...HEAD`], cwd);
            const [behindStr, aheadStr] = aheadBehind.trim().split("\t");
            behind = parseInt(behindStr) || 0;
            ahead = parseInt(aheadStr) || 0;
        } catch (error) {
            // upstream이 없는 경우 무시
        }

        return {
            branch,
            ahead,
            behind,
            modified,
            added,
            deleted,
        };
    } catch (error) {
        console.error("Failed to get git status:", error);
        return null;
    }
};

/**
 * 최근 커밋 조회
 */
export const getRecentCommits = async (cwd: string, count: number = 10): Promise<Commit[]> => {
    try {
        const isGitRepo = await checkGitRepo(cwd);
        if (!isGitRepo) {
            return [];
        }

        const output = await execGit(
            ["log", `-${count}`, "--pretty=format:%H%n%an%n%aI%n%s%n---END---"],
            cwd
        );

        const commits: Commit[] = [];
        const lines = output.split("\n");
        
        for (let i = 0; i < lines.length; i += 5) {
            if (i + 3 < lines.length) {
                commits.push({
                    hash: lines[i],
                    author: lines[i + 1],
                    date: lines[i + 2],
                    message: lines[i + 3],
                });
            }
        }

        return commits;
    } catch (error) {
        console.error("Failed to get recent commits:", error);
        return [];
    }
};

/**
 * Git diff 조회
 */
export const getGitDiff = async (cwd: string): Promise<GitDiffResult | null> => {
    try {
        const isGitRepo = await checkGitRepo(cwd);
        if (!isGitRepo) {
            return {
                tracked: false,
                method: "none",
                modified: [],
                added: [],
                deleted: [],
            };
        }

        // git status로 변경된 파일 목록 확인
        const status = await getGitStatus(cwd);
        if (!status) {
            return null;
        }

        // git diff로 변경 내용 확인
        const diff = await execGit(["diff", "HEAD"], cwd);

        // 파일별 추가/삭제 라인 수 계산
        const modified = await Promise.all(
            status.modified.map(async (path) => {
                try {
                    const stat = await execGit(["diff", "--numstat", "HEAD", "--", path], cwd);
                    const [additions, deletions] = stat.split("\t").map((n) => parseInt(n) || 0);
                    return { path, additions, deletions };
                } catch {
                    return { path, additions: 0, deletions: 0 };
                }
            })
        );

        return {
            tracked: true,
            method: diff.trim() ? "partial" : "clean",
            modified,
            added: status.added,
            deleted: status.deleted,
            diff: diff.trim() || undefined,
        };
    } catch (error) {
        console.error("Failed to get git diff:", error);
        return null;
    }
};

/**
 * Git 명령어 실행
 */
const execGit = (args: string[], cwd: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const git = spawn("git", args, { cwd });
        let output = "";
        let error = "";

        git.stdout.on("data", (data) => {
            output += data.toString();
        });

        git.stderr.on("data", (data) => {
            error += data.toString();
        });

        git.on("close", (code) => {
            if (code === 0) {
                resolve(output);
            } else {
                reject(new Error(error || `Git command failed with code ${code}`));
            }
        });
    });
};

/**
 * Git 저장소 여부 확인
 */
const checkGitRepo = async (cwd: string): Promise<boolean> => {
    return new Promise((resolve) => {
        const git = spawn("git", ["rev-parse", "--git-dir"], { cwd });
        git.on("close", (code) => {
            resolve(code === 0);
        });
    });
};
