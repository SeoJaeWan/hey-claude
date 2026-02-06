# PTY + Hooks 아키텍처 - Phase 5 프론트엔드 구현

## 개요

PTY 기반 Claude CLI 프로세스와 실시간 통신하는 프론트엔드 UI를 구현했습니다.

### 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      프론트엔드 (React)                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PtyChatPage (/pty/:sessionId)                              │
│  ├─ TerminalOutput (SSE 스트림 수신)                         │
│  └─ TerminalInput (REST API 전송)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/SSE
                           │
┌─────────────────────────────────────────────────────────────┐
│                       백엔드 (Express)                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  /api/pty/stream/:sessionId (SSE)                           │
│  /api/pty/input/:sessionId (REST)                           │
│  /api/pty/create (REST)                                     │
│                                                             │
│  claudeProcessManager (node-pty)                            │
│  ├─ PTY 프로세스 생성/관리                                   │
│  └─ 출력 스트리밍                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ stdin/stdout
                           │
┌─────────────────────────────────────────────────────────────┐
│                    Claude CLI 프로세스                       │
│                      (TUI 출력)                             │
└─────────────────────────────────────────────────────────────┘
```

## 구현된 컴포넌트

### 1. TerminalOutput
**위치**: `src/ui/components/chat/terminalOutput/index.tsx`

**기능**:
- SSE로 PTY 출력 스트리밍
- ANSI escape codes 원본 유지 (monospace 폰트로 표시)
- 자동 스크롤 (사용자가 위로 스크롤하면 비활성화)
- 프로세스 종료 감지

**특징**:
- 복잡한 ANSI 파싱 라이브러리 없이 원본 출력 유지
- 브라우저 기본 monospace 폰트 사용
- 메모리 효율적 (DOM 직접 조작)

### 2. TerminalInput
**위치**: `src/ui/components/chat/terminalInput/index.tsx`

**기능**:
- PTY stdin으로 입력 전송
- Enter: 전송 (newline 추가)
- Shift+Enter: 줄바꿈

**API**:
```typescript
<TerminalInput
  sessionId="session-123"
  disabled={false}
  onSend={(input) => console.log('Sent:', input)}
/>
```

### 3. PtyChatPage
**위치**: `src/ui/pages/ptyChat/index.tsx`

**기능**:
- PTY 세션 생성 및 관리
- TerminalOutput + TerminalInput 통합
- 로딩 상태 표시

**라우트**: `/pty/:sessionId`

## API 훅

### usePtySession
**위치**: `src/ui/hooks/apis/queries/pty/index.ts`

**제공 훅**:
```typescript
// 1. PTY 세션 생성
const {createSession, isCreating, error} = useCreatePtySession();
await createSession(sessionId, claudeSessionId, cwd);

// 2. PTY 세션 상태 조회
const {getStatus, isLoading, error} = usePtyStatus();
const status = await getStatus(sessionId);

// 3. PTY 세션 종료
const {terminate, isTerminating, error} = useTerminatePtySession();
await terminate(sessionId);

// 4. PTY 리사이즈
const {resize} = useResizePty();
await resize(sessionId, 80, 24);
```

## 백엔드 API 엔드포인트

### 1. POST /api/pty/create
PTY 세션 생성

**Request**:
```json
{
  "sessionId": "optional-id",
  "claudeSessionId": "optional-claude-session-id",
  "cwd": "/path/to/project"
}
```

**Response**:
```json
{
  "success": true,
  "sessionId": "session-123",
  "claudeSessionId": "claude-abc"
}
```

### 2. GET /api/pty/stream/:sessionId
SSE로 PTY 출력 스트리밍

**Events**:
- `connected`: 연결 확인
- `output`: 터미널 출력 (ANSI 포함)
- `exit`: 프로세스 종료

**Event Data**:
```json
// output
{"type": "output", "data": "Hello\x1b[32mWorld\x1b[0m\n"}

// exit
{"type": "exit", "code": 0}
```

### 3. POST /api/pty/input/:sessionId
PTY stdin으로 입력 전송

**Request**:
```json
{
  "input": "ls -la\n"
}
```

**Response**:
```json
{
  "success": true
}
```

### 4. POST /api/pty/resize/:sessionId
PTY 크기 조정

**Request**:
```json
{
  "cols": 80,
  "rows": 24
}
```

### 5. DELETE /api/pty/:sessionId
PTY 세션 종료

### 6. GET /api/pty/status/:sessionId
PTY 세션 상태 조회

**Response**:
```json
{
  "exists": true,
  "state": "running",
  "sessionId": "session-123",
  "claudeSessionId": "claude-abc",
  "lastActivityAt": "2025-02-06T10:00:00Z"
}
```

## 사용 방법

### 1. PTY 세션 시작

```typescript
// 1. 세션 생성 (DB 등록)
const newSession = await createSession({
  type: "claude-code",
  source: "web",
  projectPath: "/path/to/project"
});

// 2. PTY 프로세스 시작
await createPtySession(newSession.id, undefined, newSession.projectPath);

// 3. PTY 페이지로 이동
navigate(`/pty/${newSession.id}`);
```

### 2. 기존 세션에 연결

```typescript
// 세션 ID로 직접 접근
navigate(`/pty/session-123`);
```

### 3. 입력 전송

```typescript
// TerminalInput에서 자동 처리됨
// 또는 직접 API 호출
await fetch(`/api/pty/input/${sessionId}`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({input: 'ls -la\n'})
});
```

## 스타일링

### Tailwind CSS 클래스

```tsx
// 터미널 배경 (다크 코드 블록)
className="bg-code-block-bg"

// 터미널 텍스트
className="text-text-primary font-mono text-sm"

// 터미널 컨테이너
className="p-4 rounded-lg overflow-y-auto whitespace-pre-wrap"
```

### CSS 변수 (design.md 참고)

```css
/* 라이트 모드 */
--code-block-bg: #1e1e1e;  /* 터미널 배경 (항상 다크) */
--text-primary: #1a1a1a;    /* 텍스트 색상 */

/* 다크 모드 */
--code-block-bg: #0d0d0d;  /* 터미널 배경 */
--text-primary: #f5f5f5;    /* 텍스트 색상 */
```

## Hooks와의 통합

PTY 출력은 **원시 터미널 출력**이며, 구조화된 데이터는 **Hooks**를 통해 별도로 수집됩니다:

### PTY SSE (`/api/pty/stream/:sessionId`)
- 원시 TUI 출력 (ANSI 포함)
- 사용자가 보는 화면과 동일

### 일반 SSE (`/api/sse/:sessionId`)
- `ask_user_question`: AskUserQuestion 이벤트
- 구조화된 질문 데이터

### Hooks 수집
- `tool_use`: 도구 사용 내역
- `file_changes`: 파일 변경사항
- `session_complete`: 세션 완료

## 제한사항 및 향후 개선

### 현재 제한사항
1. **ANSI 파싱 없음**: 복잡한 TUI는 제대로 렌더링되지 않을 수 있음
2. **커서 위치 추적 없음**: ANSI escape codes로 커서 이동 시 DOM 기반 렌더링과 불일치 가능
3. **성능**: 대량 출력 시 DOM 직접 조작으로 인한 성능 저하 가능

### 향후 개선 사항
1. **xterm.js 통합**: 완전한 터미널 에뮬레이터
   ```typescript
   import { Terminal } from 'xterm';
   const term = new Terminal();
   term.open(document.getElementById('terminal'));
   term.write(data);
   ```

2. **리사이즈 자동 감지**: ResizeObserver로 터미널 크기 자동 조정

3. **세션 복원**: 페이지 새로고침 시 이전 출력 복원

4. **복사/붙여넣기**: 터미널 텍스트 선택 및 복사

5. **테마 연동**: 라이트/다크 모드에 따른 ANSI 색상 변경

## 디버깅

### SSE 연결 확인
```javascript
// 브라우저 개발자 도구 콘솔
const eventSource = new EventSource('/api/pty/stream/session-123');
eventSource.addEventListener('output', (e) => {
  console.log('Output:', JSON.parse(e.data));
});
```

### PTY 상태 확인
```bash
# API 직접 호출
curl http://localhost:7777/api/pty/status/session-123
```

### 로그 확인
```javascript
// 프론트엔드: 브라우저 콘솔
// 백엔드: 서버 콘솔
console.log('[PTY] ...');
```

## 참고 문서

- [design.md](../.claude/domain/design.md) - 디자인 시스템
- [coding-rules.md](../.claude/domain/coding-rules.md) - 코딩 규칙
- [folder-structure.md](../.claude/domain/folder-structure.md) - 폴더 구조

## 관련 파일

### 프론트엔드
- `src/ui/pages/ptyChat/index.tsx` - PTY 채팅 페이지
- `src/ui/components/chat/terminalOutput/index.tsx` - 터미널 출력
- `src/ui/components/chat/terminalInput/index.tsx` - 터미널 입력
- `src/ui/hooks/apis/queries/pty/index.ts` - PTY API 훅
- `src/ui/types/index.ts` - PTY 타입 정의
- `src/ui/locales/ko.json` - 한국어 번역
- `src/ui/locales/en.json` - 영어 번역

### 백엔드
- `src/server/routes/pty.ts` - PTY 라우트
- `src/server/services/claudeProcessManager.ts` - PTY 프로세스 관리

## 라이선스

MIT
