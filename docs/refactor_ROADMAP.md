# Refactor ROADMAP — SOLID 리팩토링

> 목적: 현행 "service-direct-Prisma" 패턴의 SRP·OCP·DIP·DRY 위반을 정리한다.
> API 계약·에러코드·응답 형태는 100% 보존하는 순수 내부 리팩토링이다.
> 생성일: 2026-06-07 | 브랜치: `refactor/solid`

---

## 위반 요약

| ID | 원칙 | 위치 | 심각도 |
|----|------|------|--------|
| A  | SRP  | `change-requests.service.ts:30-92` — `createChangeRequest` 7책임 | 높음 |
| B  | OCP  | 필드 머지(`change-requests.service.ts:145-192`)·스냅샷·비교(`history.service.ts:101-112`) 3곳 분산 | 높음 |
| C  | DRY  | approve/reject `findFirst+검증` 블록 중복(`change-requests.service.ts:114-131` ↔ `:222-239`) | 중간 |
| D  | DIP/SRP | Repository 부재 — 세 서비스가 `PrismaService` 직접 호출 | 중간 |
| E  | DRY  | `new HttpException({code,message},status)` 보일러플레이트 전체 반복 | 낮음 |
| F  | DRY  | `STATUS_RANK` 확정 검증 중복(`change-requests.service.ts:41` ↔ `:135`) | 낮음 |

---

## Step 1 — E: `businessError` 헬퍼 도입

- **목적**: `new HttpException({code, message}, status)` 6줄 패턴을 1줄 헬퍼로 압축한다.
- **작업 내용**:
  - [x] `src/common/exceptions/business.exception.ts` 생성
    ```ts
    export function businessError(code: ErrorCodeKey): never {
      throw new HttpException(
        { code, message: ErrorCode[code].message },
        ErrorCode[code].status,
      );
    }
    ```
  - [x] 세 서비스 + `roles.guard.ts` + `validate-specs-quantity.helper.ts`의 모든 `throw new HttpException(...)` 치환 (6파일 21곳, 응답 형태 불변)
- **영향 테스트**: 없음 (응답 `getStatus()·getResponse().code` 동일)
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 2 — F + C + A: 서비스 내 private 메서드 추출

- **목적**: Prisma 구조 변경 없이 서비스 책임을 분리한다.
- **작업 내용**:
  - [x] **F** — `ChangeRequestsService.assertOrderConfirmed(order)` private 추출  
    `createChangeRequest:41`·`approveChangeRequest:135` 중복 제거
  - [x] **C** — `ChangeRequestsService.loadPendingChangeRequest(orderId, requestId)` private 추출  
    `findFirst → CHANGE_REQUEST_NOT_FOUND → CHANGE_REQUEST_NOT_PENDING` 블록 중복 제거
  - [x] **A** — `createChangeRequest` 오케스트레이션 thin하게  
    - `assertOrderOwner(order, userId)` — NOT_ORDER_OWNER  
    - `assertOrderConfirmed(order)` — (F 재사용)  
    - `assertChangesPresent(changes)` — CHANGES_REQUIRED  
    - specs 검증 — 기존 `validateSpecsQuantity` 그대로  
    - 트랜잭션/로깅 — 서비스에 유지 (아직 repository 미도입)
- **영향 테스트**: 없음 (Prisma mock 구조 미변경)
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 3 — B: `ORDER_FIELDS` 필드 메타데이터 추상화

- **목적**: 머지·스냅샷·비교 직렬화가 각기 다른 곳에 하드코딩된 5개 필드 목록을 단일 배열로 통합한다. 새 필드 추가 시 배열 1곳만 수정하면 세 용도가 자동 반영된다.
- **작업 내용**:
  - [x] `src/common/constants/order-fields.const.ts` 생성
    ```ts
    export interface OrderFieldDescriptor {
      key: 'productName' | 'quantity' | 'unitPrice' | 'specs' | 'deliveryDate';
      // approve 머지 시 changes 값을 DB 쓰기용 타입으로 변환
      fromChange: (v: unknown) => unknown;
      // history 비교용 정규화 (Decimal→String, Date→ISO, 그 외→JSON.stringify)
      serialize: (v: unknown) => string;
    }

    export const ORDER_FIELDS: OrderFieldDescriptor[] = [
      { key: 'productName',  fromChange: v => v,                     serialize: v => JSON.stringify(v) },
      { key: 'quantity',     fromChange: v => v,                     serialize: v => JSON.stringify(v) },
      { key: 'unitPrice',    fromChange: v => Number(v),             serialize: v => String(v) },
      { key: 'specs',        fromChange: v => v,                     serialize: v => JSON.stringify(v) },
      { key: 'deliveryDate', fromChange: v => new Date(v as string), serialize: v => v instanceof Date ? v.toISOString() : String(v) },
    ];
    ```
  - [x] `mergeChanges(order, changes)` 헬퍼: `ORDER_FIELDS`를 돌며 머지 값 반환
  - [x] `buildVersionData(source, meta)` 헬퍼: `ORDER_FIELDS`의 key로 5필드 추출 + `{version, changedBy, reason, changeRequestId}`
  - [x] `HistoryService.serializeField` private 제거 → `ORDER_FIELDS[*].serialize` 사용
  - [x] `compareVersions` 루프에서 `ORDER_FIELDS` 사용
- **주의**: `unitPrice` 타입 — confirm 경로는 `order.unitPrice`(Decimal) 그대로, approve 경로는 `fromChange`(Number 변환) 후 전달. `buildVersionData`는 raw 값을 그대로 받아 두 경로 타입 보존.
- **영향 테스트**: `history.service.spec.ts` — diff 입출력 동일하므로 무수정 통과 확인
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 4 — D-1: HistoryRepository 도입 (읽기 전용)

- **목적**: 가장 단순한 읽기 전용 repository로 패턴을 정립한다.
- **작업 내용**:
  - [x] `src/history/history.repository.ts` 생성 (`@Injectable()` 구체 클래스)
    - `findVersionsByOrder(orderId)`
    - `findVersion(orderId, version)`
    - `findLatestVersionBefore(orderId, date)`
    - `findStatusLogsByOrder(orderId)`
  - [x] `HistoryModule.providers`에 `HistoryRepository` 추가
  - [x] `HistoryService` 생성자: `PrismaService` → `HistoryRepository`
  - [x] `history.service.spec.ts` mock 교체: prisma model mock → repository 메서드 mock  
    `new HistoryService(mockHistoryRepository, mockOrdersService)`
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 5 — D-2: OrdersRepository 도입 + `confirmWithSnapshot` 트랜잭션 이전

- **목적**: 확정 트랜잭션(3 테이블)·P2025 처리를 repository로 캡슐화한다.
- **작업 내용**:
  - [ ] `src/orders/orders.repository.ts` 생성
    - `create(data)` — `purchaseOrder.create` 래핑
    - `findById(id)` — `findUnique({where:{id}})`, 없으면 `null` 반환 (404 throw는 서비스)
    - `confirmWithSnapshot(order, userId)` — 내부에서 `$transaction` + `purchaseOrder.update(guard:PENDING)` + `purchaseOrderVersion.create`(`buildVersionData` 사용) + `orderStatusLog.create` + P2025→`INVALID_STATUS_TRANSITION` 변환
  - [ ] `OrdersModule.providers`에 `OrdersRepository` 추가
  - [ ] `OrdersService` 생성자: `PrismaService` → `OrdersRepository`
  - [ ] `orders.service.spec.ts` 재작성: `new OrdersService(mockOrdersRepository)`  
    트랜잭션 내부(update/create 인자) 어서션 → 신규 `orders.repository.spec.ts`로 이전
  - [ ] `orders.repository.spec.ts` 신규 생성  
    `$transaction:(cb)=>cb(mockPrisma)` 패턴 유지, P2025·Serializable 검증
- **주의**: `orders.service.spec` logger spy 테스트 — P2025 변환은 repository, **logger.error는 서비스 try/catch 유지**이므로 `mockOrdersRepository.confirmWithSnapshot.mockRejectedValue(httpException)`으로 재작성
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 6 — D-3: ChangeRequestsRepository 도입 + 트랜잭션 이전

- **목적**: 가장 복잡한 Serializable 트랜잭션·approve 합성 연산을 repository로 캡슐화한다.
- **작업 내용**:
  - [ ] `src/change-requests/change-requests.repository.ts` 생성
    - `findByIdAndOrder(requestId, orderId)` — `changeRequest.findFirst`
    - `findFirstPendingByOrder(orderId)` — PENDING 중복 체크용
    - `findManyByOrder(orderId)` — `findMany(orderBy: createdAt asc)`
    - `createPendingWithDuplicateGuard(input)` — `Serializable` `$transaction`: findFirst(중복) + create. 중복 시 `CHANGE_REQUEST_ALREADY_PENDING` throw
    - `approveWithVersion(params)` — `$transaction`: `changeRequest.update(guard:PENDING)` + `purchaseOrder.update` + `purchaseOrderVersion.create`(`buildVersionData` 사용) + P2025→`CHANGE_REQUEST_NOT_PENDING` 변환
    - `reject(requestId, reviewData)` — 단순 `changeRequest.update`
  - [ ] `ChangeRequestsModule.providers`에 `ChangeRequestsRepository` 추가
  - [ ] `ChangeRequestsService` 생성자: `PrismaService` → `ChangeRequestsRepository`  
    `mergeChanges` 호출 → `approveWithVersion` 인자로 전달
  - [ ] `change-requests.service.spec.ts` (534줄) 재작성  
    `new ChangeRequestsService(mockChangeRequestsRepository, mockOrdersService)`  
    트랜잭션 내부 어서션 → 신규 `change-requests.repository.spec.ts`로 이전
  - [ ] `change-requests.repository.spec.ts` 신규 생성  
    Serializable 격리수준 전달·P2025 변환·머지 결과 version create 검증
- **주의**: 기존 `$transaction` 두 번째 인자 `{isolationLevel:'Serializable'}` 전달 여부를 repository spec에서 명시 검증 추가
- **검증**:
  ```bash
  yarn test
  yarn build
  ```

---

## Step 7 — 마무리: 잔존 Prisma import 제거 + lint

- **목적**: 서비스 파일에서 `PrismaService`·`Prisma` import를 제거해 DIP 달성을 명시적으로 확인한다.
- **작업 내용**:
  - [ ] 세 서비스에서 `import { PrismaService }` 제거 (repository가 담당)
  - [ ] 서비스에 남은 `import { Prisma }` 제거 (`P2025` 참조가 repository로 이동했으므로)
  - [ ] `yarn lint --fix`, `yarn format` 실행
- **검증**:
  ```bash
  yarn test
  yarn test:cov   # 커버리지 회귀 확인
  yarn build
  ```

---

## 최종 파일 구조 (신규 생성 목록)

```
src/
  common/
    constants/
      order-fields.const.ts         # Step 3 — ORDER_FIELDS 메타데이터 + 헬퍼
    exceptions/
      business.exception.ts         # Step 1 — businessError() 헬퍼
  orders/
    orders.repository.ts            # Step 5 — create/findById/confirmWithSnapshot
    orders.repository.spec.ts       # Step 5 — 트랜잭션 어서션 이전
  change-requests/
    change-requests.repository.ts   # Step 6 — CRUD + Serializable + approve 합성
    change-requests.repository.spec.ts  # Step 6 — 트랜잭션·P2025 어서션 이전
  history/
    history.repository.ts           # Step 4 — 읽기 전용 CRUD
```

## 범위 밖 (이번 리팩토링에서 건드리지 않음)

- API 계약·라우팅·DTO·Swagger 데코레이터 (컨트롤러 무변경)
- 에러코드 맵 내용·HTTP status 숫자 (`businessError`는 형태만 압축)
- `PrismaService`·`PrismaModule`·MariaDB 어댑터 구성
- 인터페이스 토큰 기반 DI (CLAUDE.md "과도한 추상화 금지" 원칙상 미채택)
- UnitOfWork·CQRS·도메인 엔티티 등 추가 아키텍처 레이어
- DB 스키마·마이그레이션
- E2E 테스트 (동작 보존이라 무영향)
