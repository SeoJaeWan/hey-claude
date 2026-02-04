# SetupBanner Component

플러그인 설치 및 시스템 설정 상태를 표시하는 배너 컴포넌트입니다.

## 사용법

```tsx
import SetupBanner from "../../components/layout/setup-banner";
import { Plug, PackageOpen, AlertTriangle } from "lucide-react";
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"info" \| "warning"` | `"info"` | 배너 스타일 (파란색/노란색) |
| `icon` | `ReactNode` | `null` | 좌측 아이콘 |
| `title` | `string` | `""` | 배너 제목 |
| `description` | `string` | `""` | 배너 설명 |
| `code` | `string \| string[]` | `undefined` | 복사 가능한 코드 (단일 또는 배열) |
| `hint` | `string` | `undefined` | 코드 아래 힌트 텍스트 |
| `actions` | `SetupBannerAction[]` | `[]` | 우측 액션 버튼들 |

### SetupBannerAction

```typescript
interface SetupBannerAction {
    label: string;
    onClick: () => void;
}
```

## 예시

### 1. Plugin 미설치 (파란색 info)

```tsx
<SetupBanner
    variant="info"
    icon={<Plug size={20} />}
    title="Plugin 설치 필요"
    description="도구 사용 내역 수집을 위해 Plugin 설치가 필요합니다."
    code={[
        "/plugin marketplace add {user}/hey-claude",
        "/plugin install hey-claude"
    ]}
    hint="Claude Code에서 실행"
    actions={[
        {
            label: "설치 안내",
            onClick: () => window.open("/docs/plugin-setup")
        }
    ]}
/>
```

### 2. better-sqlite3 미설치 (노란색 warning)

```tsx
<SetupBanner
    variant="warning"
    icon={<PackageOpen size={20} />}
    title="better-sqlite3 설치 필요"
    description="데이터 저장을 위해 better-sqlite3가 필요합니다."
    code="npm install -g better-sqlite3"
    hint="설치 후 페이지를 새로고침하세요."
    actions={[
        {
            label: "새로고침",
            onClick: () => window.location.reload()
        }
    ]}
/>
```

### 3. Claude Code 미설치 (노란색 warning)

```tsx
<SetupBanner
    variant="warning"
    icon={<AlertTriangle size={20} />}
    title="Claude Code가 설치되어 있지 않습니다"
    description="Claude Code 세션을 사용하려면 설치가 필요합니다."
    code="npm install -g @anthropic-ai/claude-code"
    actions={[
        {
            label: "다운로드",
            onClick: () => window.open("https://claude.ai/download")
        }
    ]}
/>
```

### 4. 단순 정보 배너 (액션 없음)

```tsx
<SetupBanner
    variant="info"
    title="환영합니다"
    description="hey-claude를 사용해주셔서 감사합니다."
/>
```

## 배너 우선순위 (design.md 참조)

| 순서 | 상태 | 색상 | 차단 여부 |
|------|------|------|-----------|
| 1 | better-sqlite3 미설치 | warning (노란색) | 전체 차단 |
| 2 | Claude Code 미설치 | warning (노란색) | Claude Code 탭만 차단 |
| 3 | Plugin 미설치 | info (파란색) | 차단 없음 |

## 기능

### 코드 복사

- 코드 블록 우측의 복사 버튼 클릭 시 클립보드에 복사됩니다.
- 복사 성공 시 2초간 체크 아이콘이 표시됩니다.
- 여러 코드 블록을 배열로 전달하면 각각 복사 버튼이 생성됩니다.

### 다크모드 지원

- `data-theme="dark"` 속성에 자동으로 반응합니다.
- info 배너: `bg-blue-500/10`, `border-blue-400`
- warning 배너: `bg-yellow-500/10`, `border-yellow-400`

## 스타일

- **정보 배너 (info)**: 파란색 (`bg-blue-50`, `border-blue-500`)
- **경고 배너 (warning)**: 노란색 (`bg-yellow-50`, `border-yellow-500`)
- **border-radius**: `rounded-md` (8px)
- **padding**: `p-4` (16px)
- **border-left**: `border-l-4` (4px)

## 조건부 렌더링 예시

```tsx
const [isPluginInstalled, setIsPluginInstalled] = useState(false);
const [isSqliteInstalled, setIsSqliteInstalled] = useState(false);
const [isClaudeCodeInstalled, setIsClaudeCodeInstalled] = useState(false);

return (
    <div>
        {/* 우선순위: better-sqlite3 > Claude Code > Plugin */}
        {!isSqliteInstalled && (
            <SetupBanner
                variant="warning"
                icon={<PackageOpen size={20} />}
                title="better-sqlite3 설치 필요"
                description="데이터 저장을 위해 better-sqlite3가 필요합니다."
                code="npm install -g better-sqlite3"
                hint="설치 후 페이지를 새로고침하세요."
                actions={[
                    { label: "새로고침", onClick: () => window.location.reload() }
                ]}
            />
        )}

        {!isClaudeCodeInstalled && (
            <SetupBanner
                variant="warning"
                icon={<AlertTriangle size={20} />}
                title="Claude Code가 설치되어 있지 않습니다"
                description="Claude Code 세션을 사용하려면 설치가 필요합니다."
                code="npm install -g @anthropic-ai/claude-code"
            />
        )}

        {!isPluginInstalled && (
            <SetupBanner
                variant="info"
                icon={<Plug size={20} />}
                title="Plugin 설치 필요"
                description="도구 사용 내역 수집을 위해 Plugin 설치가 필요합니다."
                code={[
                    "/plugin marketplace add {user}/hey-claude",
                    "/plugin install hey-claude"
                ]}
                hint="Claude Code에서 실행"
                actions={[
                    { label: "설치 안내", onClick: () => {} }
                ]}
            />
        )}
    </div>
);
```

## 참고

- design.md 섹션 6.15 플러그인 설치 배너 참조
- lucide-react 아이콘 라이브러리 사용
- Tailwind CSS 유틸리티 클래스 사용
