import {useState, KeyboardEvent} from "react";
import {Send} from "lucide-react";
import {useTranslation} from "../../../contexts/language";

interface TerminalInputProps {
    sessionId: string;
    disabled?: boolean;
    onSend?: (input: string) => void;
}

/**
 * TerminalInput 컴포넌트
 *
 * PTY stdin으로 입력을 전송합니다.
 * Enter: 전송 (newline 포함)
 * Shift+Enter: 줄바꿈
 */
const TerminalInput = ({sessionId, disabled = false, onSend}: TerminalInputProps) => {
    const {t} = useTranslation();
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);

    const handleSend = async () => {
        if (!input.trim() || isSending || disabled) return;

        setIsSending(true);

        try {
            // PTY stdin으로 전송 (newline 추가)
            const response = await fetch(`/api/pty/input/${sessionId}`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({input: input + "\n"})
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // 성공 시 입력창 초기화
            setInput("");
            onSend?.(input);
        } catch (error) {
            console.error("[Terminal] Send error:", error);
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter (without Shift): Send
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex items-end gap-2 p-4 border-t border-border-default bg-bg-secondary">
            <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("terminal.inputPlaceholder")}
                disabled={disabled || isSending}
                className="
                    flex-1
                    min-h-[44px]
                    max-h-[200px]
                    px-4 py-3
                    bg-bg-input
                    border border-border-default
                    rounded-lg
                    text-base
                    font-mono
                    text-text-primary
                    placeholder:text-text-tertiary
                    resize-none
                    focus:outline-none
                    focus:border-border-focus
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                "
                rows={1}
            />
            <button
                onClick={handleSend}
                disabled={!input.trim() || isSending || disabled}
                className="
                    flex items-center justify-center
                    w-11 h-11
                    bg-accent-primary
                    text-text-inverse
                    rounded-lg
                    hover:bg-accent-hover
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                    transition-colors
                "
            >
                <Send size={20} />
            </button>
        </div>
    );
};

export default TerminalInput;
