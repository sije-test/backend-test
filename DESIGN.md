# 변경 이력 관리 설계

## 1. 선택한 방식

### 개요

**스냅샷-only 전략**을 선택했다. 변경이 승인될 때마다 발주서의 전체 상태를 `PurchaseOrderVersion` 테이블에 1행으로 저장한다. 변경분(델타)은 별도로 저장하지 않는다.

- 확정 시 → 버전 1 스냅샷 생성
- 변경요청 승인 시 → 버전 N 스냅샷 생성 (`currentVersion: { increment: 1 }` 후 반환된 값을 version으로 사용)
- 반려·생산중·완료 전이 시 → 스냅샷 미생성 (내용 변경 없음)

### 데이터 구조

```
PurchaseOrder (발주서 현재 상태)
  │  1 : N
  ├─ PurchaseOrderVersion (버전 스냅샷)
  │    @@unique([orderId, version])
  │    @@index([orderId, createdAt, version])
  │
  ├─ ChangeRequest (변경요청)
  │    1 : 0~1
  │    └─ PurchaseOrderVersion.changeRequestId (버전1은 null, 이후는 승인된 변경요청 id)
  │
  └─ OrderStatusLog (상태 전이 이력)
       @@index([orderId, createdAt])
```

#### 핵심 필드 설명

| 모델 | 필드 | 설명 |
|------|------|------|
| `PurchaseOrder` | `currentVersion` | 현재까지 생성된 버전 번호. 확정 시 1, 승인마다 +1 |
| `PurchaseOrderVersion` | `version` | 1부터 시작하는 순번. `(orderId, version)` UNIQUE |
| `PurchaseOrderVersion` | `changeRequestId` | 버전1(확정 시)은 null, 이후 버전은 승인된 변경요청 id |
| `PurchaseOrderVersion` | `createdAt` | 해당 버전의 effective 시점 — 시점 조회의 기준 |
| `OrderStatusLog` | `fromStatus` / `toStatus` | 상태 전이 직전·직후. 상태 전이마다 1행 insert |

### 동작 방식

#### 발주서 확정 시 (단일 트랜잭션)

```
1. purchaseOrder.update  status: PENDING → CONFIRMED, currentVersion: 1
   (where: { status: PENDING } — 낙관적 동시성 가드)
2. purchaseOrderVersion.create  version=1, changeRequestId=null, reason="초기 확정"
3. orderStatusLog.create  fromStatus=PENDING, toStatus=CONFIRMED
```

#### 변경요청 승인 시 (단일 트랜잭션)

```
사전 검증 (트랜잭션 외부):
- 변경요청 상태가 PENDING인지 확인
- 발주서가 CONFIRMED 이상 상태인지 확인 (PRD 미명시, 구현 추가 검증)

트랜잭션:
1. changeRequest.update  status: PENDING → APPROVED, reviewedBy, reviewedAt
   (where: { status: PENDING } — 낙관적 동시성 가드)
2. purchaseOrder.update  changes 필드 반영, currentVersion: { increment: 1 }
3. purchaseOrderVersion.create  version=updatedOrder.currentVersion (increment 후 값), changeRequestId=requestId
   ※ orderStatusLog 미생성 — 발주서 status가 CONFIRMED로 유지되어 상태 전이 없음
```

#### 상태 전이 시 (단일 트랜잭션, confirm 외 start-production · complete)

```
1. purchaseOrder.update  status: from → to
   (where: { status: from } — 낙관적 동시성 가드)
2. orderStatusLog.create  fromStatus=from, toStatus=to
   ※ 내용 변경 없는 순수 상태 전이이므로 버전 스냅샷 미생성
```

#### 특정 시점 조회 쿼리

```sql
SELECT * FROM purchase_order_versions
WHERE order_id = :orderId AND created_at <= :timestamp
ORDER BY created_at DESC
LIMIT 1
```

`@@index([orderId, createdAt, version])`이 이 쿼리를 커버한다.

#### 버전 비교 diff 연산

```typescript
// Decimal/Date/Json이 혼재 → 타입별 serialize로 정규화 후 문자열 비교
// 비교는 직렬화 후, 응답에는 raw 값을 반환 (클라이언트가 올바른 타입으로 수신)
for (const field of ORDER_FIELDS) {
  const before = field.serialize(fromSnapshot[field.key]);
  const after  = field.serialize(toSnapshot[field.key]);
  if (before !== after) diff.push({ field: field.key, before: fromSnapshot[field.key], after: ... });
}
```

`ORDER_FIELDS` 디스크립터(`src/common/constants/order-fields.const.ts`)가 비교 대상 5개 필드(`productName`, `quantity`, `unitPrice`, `specs`, `deliveryDate`)의 serialize · fromChange · buildVersion 로직을 단일 출처로 관리한다.

---

## 2. 의사결정 과정

### 고려한 대안

#### 방법 A. 스냅샷-only (선택)

변경 승인마다 발주서 전체 상태를 별도 테이블에 1행 저장한다.

| 장점 | 단점 |
|------|------|
| 버전·시점 조회 시 단순 SELECT 1회로 완결 | 변경이 많을수록 스냅샷 행 증가 (허용 가능한 수준) |
| 스냅샷 자체가 진실 원천 — 델타 불일치 위험 없음 | 변경되지 않은 필드도 중복 저장 |
| 서비스 레이어에서 replay 불필요 | — |
| 4종 조회 중 3종(이력·버전·시점)이 전체 상태 필요 → 자연스러운 단위 | — |

#### 방법 B. 델타-only (이벤트 소싱)

변경될 때마다 변경된 필드만 이벤트로 저장하고, 조회 시 초기 상태부터 이벤트를 순서대로 적용(replay)해 현재 상태를 재구성한다.

| 장점 | 단점 |
|------|------|
| 저장 공간 최소화 | 버전·시점 조회 시 초기 상태부터 전체 replay 필요 |
| "무엇이 변경되었는가"가 명시적 | 조회 로직 복잡, 버그 가능성 높음 |
| — | 스냅샷 없이 특정 시점 상태를 O(n) 연산으로 재구성 |

#### 방법 C. 스냅샷 + 델타 병행

스냅샷 테이블과 델타(변경 이벤트) 테이블을 모두 유지한다.

| 장점 | 단점 |
|------|------|
| 조회(스냅샷)와 추적(델타) 모두 최적 | 두 테이블의 동기화 관리 필요 — 정합성 위험 |
| — | 구현 복잡도 증가 |
| — | 성능 이점은 이 과제의 평가 범위 밖 |

### 최종 선택 이유

1. **요구사항과 자연스럽게 대응**: 4종 이력 조회 중 이력 목록·특정 버전·특정 시점 3가지가 발주서 **전체 상태**를 필요로 한다. 스냅샷이 곧 응답 데이터이므로 변환 로직이 없다.

2. **단일 진실 원천**: 스냅샷이 유일한 이력 데이터 원천이므로 델타-스냅샷 불일치 같은 정합성 위험이 없다.

3. **조회 단순성**: 시점 조회는 `lte + desc + LIMIT 1` 인덱스 조회 1회, 버전 비교는 스냅샷 2건 조회 후 런타임 diff — 모두 추가 연산 없이 O(1)이다.

4. **복잡도-효과 균형**: 대용량 처리·성능 최적화는 평가 범위 제외이므로 스냅샷 중복 저장의 단점이 실질적 비용이 되지 않는다.

---

## 3. 구현 상세

### 핵심 로직

#### 낙관적 동시성 가드 + P2025 변환

```typescript
// orders.repository.ts, change-requests.repository.ts 공통 패턴
try {
  await prisma.$transaction(async (tx) => {
    // where 조건에 status를 포함해 기대 상태가 아니면 Prisma P2025(RecordNotFound) 발생
    await tx.purchaseOrder.update({
      where: { id: orderId, status: expectedStatus },
      data: { status: nextStatus },
    });
    // ...
  });
} catch (err) {
  if (err?.code === 'P2025') businessError('INVALID_STATUS_TRANSITION');
  throw err;
}
```

서비스 레이어의 사전 상태 검증과 이중 방어선을 형성한다.
- 서비스: `order.status !== expected` → 즉시 `businessError` (조기 실패, 빠른 피드백)
- 리포지토리: P2025 → `businessError` (동시 요청이 사전 검증을 통과한 경우 처리)

#### PENDING 중복 가드 (Serializable 트랜잭션)

변경요청 생성 시 "PENDING 체크 → 생성" 구간에 동시 요청이 끼어들어 중복 생성되는 것을 막기 위해, 트랜잭션이 완료되기 전까지 다른 트랜잭션이 같은 데이터에 접근하지 못하도록 `Serializable` 격리 수준을 사용한다.

```typescript
// change-requests.repository.ts
await prisma.$transaction(
  async (tx) => {
    const existing = await tx.changeRequest.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (existing) businessError('CHANGE_REQUEST_ALREADY_PENDING');
    return tx.changeRequest.create({ data: { ... } });
  },
  { isolationLevel: 'Serializable' },
);
```

#### ORDER_FIELDS 디스크립터 패턴

`src/common/constants/order-fields.const.ts`가 변경 가능 5개 필드의 변환·비교 로직을 단일 출처로 관리한다.

```typescript
const ORDER_FIELDS = [
  { key: 'quantity',     fromChange: v => v,             serialize: v => JSON.stringify(v) },
  { key: 'unitPrice',    fromChange: v => Number(v),     serialize: v => String(v) },
  { key: 'deliveryDate', fromChange: v => new Date(v),   serialize: v => v.toISOString() },
  { key: 'specs',        fromChange: v => v,             serialize: v => JSON.stringify(v) },
  { key: 'productName',  fromChange: v => v,             serialize: v => JSON.stringify(v) },
];
```

- `fromChange`: approve 시 changes 값을 DB 저장 타입으로 변환
- `serialize`: 버전 비교 시 `Decimal` / `Date` / `Json` 을 문자열로 정규화 (단순 `===` 비교 불가 문제 해결)
- `buildVersionData`: 스냅샷 생성 시 5개 필드 + 메타 데이터를 조립

새 변경 가능 항목 추가 시 이 디스크립터에만 필드를 추가하면 merge·compare·snapshot 로직이 자동으로 반영된다.

### 트랜잭션 전략 요약

| 작업 | 트랜잭션 | 격리 수준 | 포함 연산 |
|------|---------|----------|----------|
| 발주서 확정 | ✅ | 기본(REPEATABLE READ) | 상태 전이 + 버전1 스냅샷 + status log |
| 변경요청 생성 | ✅ | **Serializable** | PENDING 중복 체크 + 변경요청 생성 |
| 변경요청 승인 | ✅ | 기본(REPEATABLE READ) | 변경요청 update + 발주서 update + 버전 스냅샷 |
| 변경요청 반려 | ❌ | — | 변경요청 update만 |
| 상태 전이(생산중·완료) | ✅ | 기본(REPEATABLE READ) | 상태 전이 + status log |

### 인덱스 설계

| 인덱스 | 테이블 | 목적 |
|--------|--------|------|
| `@@unique([orderId, version])` | `PurchaseOrderVersion` | 버전 단건 조회(`findVersion`) — `orderId_version` 복합 unique 키로 O(1) 조회 |
| `@@index([orderId, createdAt])` | `PurchaseOrderVersion` | 시점 조회(`lte + desc + LIMIT 1`) 및 이력 목록 정렬 지원 |
| `@@index([orderId, createdAt])` | `OrderStatusLog` | 상태 이력 조회(`orderId` 필터 + `createdAt` ASC 정렬) |

### 예외 상황 처리

| 상황 | 에러 코드 | HTTP |
|------|----------|------|
| 존재하지 않는 발주서 | `ORDER_NOT_FOUND` | 404 |
| 존재하지 않는 버전 | `VERSION_NOT_FOUND` | 404 |
| 해당 시점 이전 버전 없음 | `VERSION_NOT_FOUND` | 404 |
| 잘못된 timestamp 형식 | `INVALID_TIMESTAMP` | 400 |
| `from > to` 버전 비교 | `INVALID_VERSION_RANGE` | 400 |
| 허용되지 않는 상태 전이 | `INVALID_STATUS_TRANSITION` | 400 |
| P2025 (동시성 충돌) | `INVALID_STATUS_TRANSITION` / `CHANGE_REQUEST_NOT_PENDING` | 400 |
| PENDING 변경요청 중복 | `CHANGE_REQUEST_ALREADY_PENDING` | 409 |
| 권한 없는 역할 | `FORBIDDEN_ROLE` | 403 |
| 발주서 생성자가 아닌 BUYER의 변경요청 생성 | `NOT_ORDER_OWNER` | 403 |