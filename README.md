# hey-claude

> Claude Code를 위한 웹 기반 프롬프트 관리 도구 + 멀티 AI 통합 + 자동 컨텍스트 관리

## 설치

```bash
npm install -g hey-claude
```

## 실행

```bash
hey-claude
```

브라우저에서 `http://localhost:7777` 자동 열림

## 개발 환경 설정

### 의존성 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

- 프론트엔드: `http://localhost:17777` (자동 할당: 17777 ~ 17877)
- 백엔드: `http://localhost:7777` (자동 할당: 7777 ~ 7877)

개발 서버는 포트 충돌 시 자동으로 다음 포트를 시도합니다.
실행 중인 포트 정보는 `.hey-claude/client.lock` (프론트엔드), `.hey-claude/server.lock` (백엔드) 파일에서 확인할 수 있습니다.

### 빌드

```bash
npm run build
```

## 기술 스택

### 프론트엔드
- React 18
- Vite
- TypeScript
- Tailwind CSS
- Zustand
- TanStack Query (React Query)

### 백엔드
- Node.js
- Express
- better-sqlite3
- TypeScript

## 폴더 구조

```
hey-claude/
├── src/
│   ├── ui/                    # React 프론트엔드
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/
│   │   ├── styles/
│   │   └── types/
│   └── server/                # Express 백엔드
│       ├── routes/
│       ├── services/
│       └── utils/
├── plugin/                    # Claude Code Plugin
├── scripts/                   # Build & dev scripts
│   └── vite-port-plugin.ts    # Vite 동적 포트 할당 플러그인
├── .hey-claude/               # 프로젝트 데이터 (개발 중에 생성됨)
│   ├── client.lock            # 프론트엔드 포트 정보 (자동 생성)
│   ├── server.lock            # 백엔드 포트 정보 (자동 생성)
│   ├── data.db                # SQLite 데이터베이스
│   └── config.json            # 설정 파일
└── dist/                      # 빌드 결과물
```

### .gitignore 권장사항

개발 중에 생성되는 lock 파일과 데이터베이스는 버전 관리에서 제외하는 것이 좋습니다:

```gitignore
# hey-claude 런타임 데이터
.hey-claude/client.lock
.hey-claude/server.lock
.hey-claude/data.db
.hey-claude/images/

# 또는 전체 .hey-claude/ 제외 (config.json 포함)
# .hey-claude/
```

## 라이선스

MIT

## 작성자

서재완
