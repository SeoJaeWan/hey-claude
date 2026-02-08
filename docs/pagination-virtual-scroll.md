# 1000개의 메시지를 어떻게 빠르게 보여줄까

Created: February 8, 2026
Tags: React, 성능 최적화, 회고
Date: 2026/02/08
Summary: 대량 메시지 렌더링 성능 문제를 서버 페이지네이션 + Virtual Scroll로 해결한 과정을 정리했습니다.

Claude Code의 웹 UI를 만들면서, 처음에는 별생각 없이 세션의 메시지를 **한 번에 전부 불러오는** 구조로 만들었습니다.

```typescript
// 초기 구현: 메시지 전체 조회
const messages = db.prepare(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC"
).all(sessionId);
```

세션당 메시지가 10~50개일 때는 아무 문제도 없었습니다.

그런데 Claude Code를 실제로 써보면, 하나의 세션에서 **수백~수천 개의 메시지**가 쌓이는 게 일상적이었습니다.
도구 호출 하나가 메시지 하나이고, 한 번의 작업에서 수십 개의 도구를 사용하니까요.

메시지가 1000개를 넘어가자, **세션을 열 때마다 3~5초씩 걸리기 시작**했습니다.

---

# 문제 진단: 어디서 느린 걸까?

느린 원인을 분리해서 생각해 봤습니다.

1. **DB 쿼리**: SQLite에서 1000개 row를 가져오는 건 수십 ms 수준 → 문제 아님
2. **네트워크 전송**: JSON 직렬화 + HTTP 응답 → 약간 있지만 주범은 아님
3. **React 렌더링**: 1000개의 Message 컴포넌트를 한 번에 마운트 → **이게 범인**

React에서 1000개의 컴포넌트를 한 번에 렌더링하면, 각 컴포넌트 안에서 Markdown 파싱(ReactMarkdown + rehype-highlight)까지 돌아가니까 **초기 렌더링만으로 수 초가 걸렸습니다.**

사용자 입장에서는 세션을 클릭한 뒤 빈 화면을 3~5초 동안 바라보는 셈이었습니다.

---

# 1단계: 서버 커서 기반 페이지네이션

가장 먼저 한 건, **서버에서 메시지를 나눠 보내는 것**이었습니다.

## 왜 Offset이 아니라 Cursor인가?

페이지네이션에는 크게 두 가지 방식이 있습니다.

### Offset 기반

```sql
SELECT * FROM messages WHERE session_id = ?
ORDER BY timestamp ASC
LIMIT 100 OFFSET 200
```

- 직관적이지만, **실시간 데이터에 취약**합니다.
- 메시지를 읽는 도중에 새 메시지가 추가되면, OFFSET이 밀려서 **같은 메시지를 두 번 보거나 빠뜨리는** 문제가 발생합니다.
- 채팅처럼 데이터가 계속 쌓이는 구조에서는 위험합니다.

### Cursor 기반

```sql
SELECT * FROM messages WHERE session_id = ? AND timestamp < ?
ORDER BY timestamp DESC
LIMIT 100
```

- **"이 시점 이전의 데이터를 100개 줘"** 방식입니다.
- 중간에 새 메시지가 들어와도, 커서(timestamp) 기준이 변하지 않으니 **중복이나 누락이 없습니다.**
- 채팅 UI처럼 **최신 → 과거 방향**으로 스크롤하는 패턴에 딱 맞습니다.

## 서버 구현

```typescript
// GET /api/sessions/:id/messages?limit=100&before=2026-02-08T12:00:00Z
router.get(":id/messages", async (req, res) => {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const before = req.query.before as string | undefined;

    let messages;
    if (before) {
        // 커서 이전의 메시지 (이전 페이지)
        messages = db.prepare(
            "SELECT * FROM messages WHERE session_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?"
        ).all(id, before, limit);
    } else {
        // 최신 메시지 (첫 요청)
        messages = db.prepare(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
        ).all(id, limit);
    }

    // DESC로 가져왔으므로 ASC 순서로 뒤집기
    messages.reverse();

    res.json({
        data: messages,
        hasMore: messages.length === limit,
    });
});
```

핵심 포인트:

- `ORDER BY timestamp DESC LIMIT 100`으로 **최신 100개를 먼저** 가져옵니다.
- 응답에 `hasMore`를 포함해서, 프론트엔드가 "더 불러올 데이터가 있는지" 알 수 있게 합니다.
- `before` 파라미터가 커서 역할을 합니다. 가장 오래된 메시지의 timestamp를 넘기면 그 이전 데이터를 가져옵니다.

## 프론트엔드: React Query의 useInfiniteQuery

서버가 페이지 단위로 데이터를 주니까, 프론트엔드에서는 React Query의 `useInfiniteQuery`를 사용했습니다.

```typescript
export const useMessagesQuery = (sessionId?: string) => {
  return useInfiniteQuery({
    queryKey: ["messages", sessionId],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (pageParam) params.set("before", pageParam);

      const res = await api.get(`/sessions/${sessionId}/messages?${params}`);
      return {
        data: res.data ?? [],
        hasMore: res.hasMore ?? false,
      };
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || !lastPage.data.length) return undefined;
      // 가장 오래된 메시지의 timestamp가 다음 커서
      return lastPage.data[0].timestamp;
    },
    select: (data) => ({
      messages: [...data.pages]
        .reverse()
        .flatMap((p) => p.data.map(convertMessage)),
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
  });
};
```

여기서 재미있는 부분은 `select`입니다.

서버에서 받은 페이지 순서는 `[최신 100개, 그 이전 100개, ...]`이지만, 화면에 보여줄 때는 **오래된 순서(ASC)**로 보여야 합니다. 그래서 `[...data.pages].reverse()`로 페이지 순서를 뒤집고, `flatMap`으로 하나의 배열로 합칩니다.

## 결과: 초기 로딩은 해결, 하지만...

이것만으로 **초기 로딩 시간은 극적으로 줄었습니다.** 1000개를 한 번에 불러오던 것이 100개만 불러오니까, 체감상 즉시 화면이 뜨는 수준이 됐습니다.

하지만 새로운 문제가 생겼습니다.

**스크롤을 올려서 이전 메시지를 불러올 때, 100개의 메시지가 한 번에 DOM에 추가되면서 버벅거렸습니다.**

200개, 300개, 400개... 스크롤을 올릴수록 DOM에 마운트된 메시지 컴포넌트가 계속 쌓이니까, 결국 **처음에 1000개를 한 번에 렌더링하는 것과 같은 문제**로 돌아왔습니다. 페이지네이션으로 초기 로딩은 해결했지만, 누적 렌더링 문제는 여전했습니다.

---

# 2단계: Virtual Scroll로 렌더링 최적화

렌더링 문제를 근본적으로 해결하려면, **화면에 보이는 메시지만 DOM에 마운트**해야 합니다. 이게 바로 Virtual Scroll(가상 스크롤)의 핵심 아이디어입니다.

## Virtual Scroll이란?

일반적인 스크롤:

```
[메시지 1]  ← DOM에 존재
[메시지 2]  ← DOM에 존재
[메시지 3]  ← DOM에 존재  ← 화면에 보임
[메시지 4]  ← DOM에 존재  ← 화면에 보임
[메시지 5]  ← DOM에 존재  ← 화면에 보임
[메시지 6]  ← DOM에 존재
...
[메시지 1000] ← DOM에 존재
```

1000개의 DOM 노드가 전부 존재합니다. 브라우저는 보이지 않는 노드도 레이아웃을 계산하고, 메모리에 유지합니다.

Virtual Scroll:

```
(빈 공간 - height로 대체)
[메시지 3]  ← DOM에 존재  ← 화면에 보임
[메시지 4]  ← DOM에 존재  ← 화면에 보임
[메시지 5]  ← DOM에 존재  ← 화면에 보임
(빈 공간 - height로 대체)
```

**화면에 보이는 3~5개 + 약간의 버퍼만 DOM에 존재**합니다. 나머지는 빈 공간(height)으로 대체되어, 스크롤바의 위치와 전체 높이는 유지되지만 실제 DOM 노드는 최소한으로 유지됩니다.

## 왜 react-virtuoso를 선택했나?

Virtual Scroll 라이브러리는 여러 가지가 있습니다.

- `react-window`: 가볍고 빠르지만, **고정 높이 아이템**에 최적화
- `react-virtualized`: 기능이 많지만 번들 크기가 큼
- `react-virtuoso`: **가변 높이 아이템 + 역방향 스크롤**을 네이티브 지원

채팅 UI에서는 메시지마다 높이가 다릅니다. 한 줄짜리 텍스트도 있고, 코드 블록이 포함된 긴 메시지도 있습니다. 그리고 **역방향 무한 스크롤**(위로 스크롤하면 이전 메시지 로드)이 필요합니다.

`react-virtuoso`는 이 두 가지를 별도 설정 없이 지원해서 선택했습니다.

## 구현: 역방향 무한 스크롤의 핵심

```tsx
const MessageList = ({ messages, hasMore, onLoadMore, isLoadingMore }) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // prepend 시 스크롤 위치 유지를 위한 인덱스
  const START_INDEX = 100000;
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);

  // 메시지가 prepend되면 firstItemIndex를 감소시켜 스크롤 유지
  const prevCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevCountRef.current;
    const newCount = messages.length;
    if (newCount > prevCount) {
      const added = newCount - prevCount;
      setFirstItemIndex((prev) => prev - added);
    }
    prevCountRef.current = newCount;
  }, [messages.length]);

  return (
    <Virtuoso
      ref={virtuosoRef}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={messages.length - 1}
      data={messages}
      startReached={() => {
        if (hasMore && !isLoadingMore) onLoadMore();
      }}
      followOutput="smooth"
      itemContent={(index, message) => (
        <Message message={message} />
      )}
    />
  );
};
```

여기서 가장 까다로웠던 부분은 **`firstItemIndex`** 입니다.

### 왜 firstItemIndex가 필요한가?

일반적인 리스트에서 아이템을 **앞에 추가(prepend)**하면, 기존 아이템의 인덱스가 전부 밀립니다.

```
변경 전: [A, B, C]  → 인덱스 0, 1, 2
변경 후: [X, Y, A, B, C] → 인덱스 0, 1, 2, 3, 4
```

이때 스크롤 위치가 "인덱스 2(C)" 근처에 있었다면, prepend 후에도 인덱스 2는 여전히 존재하지만 **실제로는 A를 가리키게** 됩니다. 사용자 입장에서는 스크롤이 갑자기 점프하는 것처럼 보입니다.

`react-virtuoso`의 `firstItemIndex`는 이 문제를 해결합니다.

```
초기: firstItemIndex = 100000
  → 아이템들의 가상 인덱스: 100000, 100001, 100002

100개 prepend 후: firstItemIndex = 99900
  → 아이템들의 가상 인덱스: 99900, 99901, ..., 100000, 100001, 100002
```

기존 아이템의 가상 인덱스가 변하지 않으니, **스크롤 위치가 자연스럽게 유지**됩니다.
초기값을 100000처럼 큰 수로 잡는 이유는, prepend가 여러 번 일어나도 인덱스가 음수가 되지 않도록 여유를 두기 위해서입니다.

### followOutput: 새 메시지 자동 스크롤

```tsx
followOutput="smooth"
```

채팅 UI에서 또 하나 중요한 동작은, **새 메시지가 추가되면 자동으로 맨 아래로 스크롤**되는 것입니다. `followOutput="smooth"`는 사용자가 맨 아래에 있을 때만 자동 스크롤을 해주고, 위로 스크롤해서 이전 메시지를 보고 있을 때는 방해하지 않습니다.

---

# 전후 비교

| 항목 | 이전 (전체 로드) | 이후 (페이지네이션 + Virtual Scroll) |
|------|-----------------|-------------------------------------|
| 초기 로딩 (1000개 세션) | 3~5초 | 즉시 (~100ms) |
| DOM 노드 수 | 1000개 메시지 전부 | 화면에 보이는 ~10개 + 버퍼 |
| 스크롤 성능 | 메시지 많아질수록 저하 | 메시지 수와 무관하게 일정 |
| 메모리 사용 | 모든 컴포넌트 마운트 | 보이는 컴포넌트만 마운트 |
| 이전 메시지 로드 | 불필요 (전부 있음) | 위로 스크롤 시 100개씩 로드 |

---

# 마무리

처음에는 "메시지 전체를 한 번에 보여주면 되지"라고 단순하게 생각했지만, 실제 사용 환경에서 데이터가 쌓이면서 성능 문제가 드러났습니다.

해결 과정을 되돌아보면 두 단계로 나뉩니다.

1. **서버 페이지네이션**: "필요한 만큼만 가져온다" → 초기 로딩 해결
2. **Virtual Scroll**: "보이는 만큼만 그린다" → 누적 렌더링 해결

이 두 가지는 각각 **네트워크 비용**과 **렌더링 비용**을 줄이는 서로 다른 레이어의 최적화입니다. 페이지네이션만으로는 스크롤할수록 DOM이 쌓이고, Virtual Scroll만으로는 초기에 전체 데이터를 가져와야 하니까, **두 가지를 조합해야 비로소 대량 데이터 UI가 쾌적**해졌습니다.

결국 "전부 다 불러와서 전부 다 그리는" 가장 단순한 구현에서, "필요한 만큼 가져와서 보이는 만큼 그리는" 구현으로 바꾼 것입니다. 말로 하면 당연한데, 직접 부딪혀봐야 체감이 됩니다.
