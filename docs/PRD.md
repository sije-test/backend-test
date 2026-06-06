# 발주서 변경 승인 프로세스 PRD

**작성일**: 2026-06-06

---

## 1. 개요

**목적**: 의류 생산 발주서의 주문자 변경 요청 → 소싱팀 승인 → 발주서 반영 프로세스를 구현하고, 모든 변경 이력을 완전하게 보존하여 과거 시점 조회·버전 비교가 가능하게 한다.

**범위**

포함:
- 발주서 생성·조회·확정
- 변경요청 생성·승인·반려
- 변경 이력 조회 4종 (이력 목록 / 특정 버전 / 특정 시점 / 버전 비교)
- 역할 기반 접근 제어 (헤더 mock)

미포함:
- JWT 인증
- 대용량 데이터 처리 (수십만 건 이상)
- 동시성 제어 (낙관적/비관적 잠금)
- 캐싱, 실시간 성능 최적화, 분산 시스템

---

## 2. 도메인 모델 / 역할

### 역할과 책임

| 역할 | 헤더 값 | 가능한 작업 |
|------|---------|-----------|
| 주문자 | `BUYER` | 발주서 생성, 변경요청 생성 |
| 소싱팀 | `SOURCING` | 발주서 확정, 변경요청 승인/반려 |
| 생산자 | `MANUFACTURER` | 발주서·변경요청 조회(읽기 전용) |

### 발주서 상태 전이

```
DRAFT → PENDING → CONFIRMED → IN_PRODUCTION → COMPLETED
                      ↑
               이 상태부터 변경요청 가능
```

- `DRAFT`: 주문자 작성 중 (생성 시 초기값)
- `PENDING`: 소싱팀 검토 대기 (향후 확장용, 현재 MVP에서는 생성 시 DRAFT로 시작)
- `CONFIRMED`: 소싱팀 확정. 버전1 스냅샷 생성. 변경요청 허용 시작점
- `IN_PRODUCTION`, `COMPLETED`: 변경요청 계속 허용

### 변경요청 상태 전이

```
PENDING → APPROVED (발주서 즉시 반영 + 버전 스냅샷 생성)
        → REJECTED (발주서 불변)
```

---

## 3. 이력 관리 전략: 스냅샷-only

### 선택

변경 승인 시마다 발주서 전체 상태를 `PurchaseOrderVersion` 테이블에 1행으로 저장한다. 델타(변경분)는 별도 저장하지 않는다.

### 동작 방식

| 작업 | 처리 |
|------|------|
| 발주서 확정 | 버전1 스냅샷 insert (트랜잭션) |
| 변경요청 승인 | 발주서 업데이트 + 버전 스냅샷 insert + 변경요청 상태 변경 (단일 트랜잭션) |
| 특정 버전 조회 | `(orderId, version)` 인덱스 조회 |
| 특정 시점 조회 | `WHERE orderId = ? AND createdAt <= ? ORDER BY createdAt DESC LIMIT 1` |
| 버전 비교 | 두 스냅샷 조회 후 서비스 레이어에서 필드별 diff 연산 |

### 고려한 대안

- **스냅샷 + 델타 병행**: 조회 성능 향상 가능하나 저장 중복 + 스냅샷/델타 불일치 위험. 성능 이점은 평가 제외 항목.
- **델타-only (이벤트 소싱)**: 버전/시점 조회 시 초기 상태부터 replay 필요, 조회 로직 복잡.

### 선택 근거

- 4종 조회 중 3종(이력, 버전, 시점)은 전체 상태가 필요 → 스냅샷이 자연스러운 단위
- 비교(1종)는 소량 데이터 런타임 diff로 충분
- 스냅샷 단일 진실원천으로 정합성 위험 제거

---

## 4. 데이터 모델

### Prisma 스키마 (schema.prisma에 그대로 복붙)

```prisma
enum PurchaseOrderStatus {
  DRAFT
  PENDING
  CONFIRMED
  IN_PRODUCTION
  COMPLETED
}

enum ChangeRequestStatus {
  PENDING
  APPROVED
  REJECTED
}

model PurchaseOrder {
  id             Int                   @id @default(autoincrement())
  productName    String
  quantity       Int
  unitPrice      Decimal               @db.Decimal(12, 2)
  specs          Json
  deliveryDate   DateTime              @db.Date
  status         PurchaseOrderStatus   @default(DRAFT)
  currentVersion Int                   @default(0)
  buyerId        String
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  versions       PurchaseOrderVersion[]
  changeRequests ChangeRequest[]
}

model PurchaseOrderVersion {
  id              Int      @id @default(autoincrement())
  orderId         Int
  version         Int
  productName     String
  quantity        Int
  unitPrice       Decimal  @db.Decimal(12, 2)
  specs           Json
  deliveryDate    DateTime @db.Date
  changedBy       String
  reason          String
  changeRequestId Int?
  createdAt       DateTime @default(now())

  order         PurchaseOrder  @relation(fields: [orderId], references: [id])
  changeRequest ChangeRequest? @relation(fields: [changeRequestId], references: [id])

  @@unique([orderId, version])
  @@index([orderId, createdAt])
}

model ChangeRequest {
  id            Int                 @id @default(autoincrement())
  orderId       Int
  requestedBy   String
  reason        String
  changes       Json
  status        ChangeRequestStatus @default(PENDING)
  reviewedBy    String?
  reviewComment String?
  createdAt     DateTime            @default(now())
  reviewedAt    DateTime?

  order    PurchaseOrder          @relation(fields: [orderId], references: [id])
  versions PurchaseOrderVersion[]
}
```

### 핵심 필드 설명

**PurchaseOrder**
- `currentVersion`: 현재까지 생성된 스냅샷 번호. 확정 시 1, 승인마다 +1
- `specs`: `{ "color": "white", "size": ["S", "M", "L"] }` 형태 JSON

**PurchaseOrderVersion**
- `version`: 1부터 시작하는 순번. `(orderId, version)` UNIQUE
- `changeRequestId`: 버전1(확정 시)은 null, 이후 버전은 승인된 변경요청 id
- `changedBy`: 확정 시 소싱팀 userId, 이후 승인마다 소싱팀 userId
- `createdAt`: 해당 버전의 effective 시점 (시점 조회 기준)

**ChangeRequest**
- `changes`: 변경할 필드만 포함. `{ "quantity": 1500, "deliveryDate": "2025-03-25" }` — 1개 이상 필수
- `reviewedAt`: 승인/반려 처리 시각

**specs DTO 구조 (strict)**
- `color`: string, 필수
- `sizes`: `Array<{ size: string, quantity: number }>`, 필수
- `color`, `sizes` 외 필드는 `forbidNonWhitelisted` 에 의해 자동 400 반환
- 새 스펙 항목이 필요할 때는 SpecsDto에 필드를 추가한다

**specs 검증 규칙**
- `specs.sizes[].quantity` 합계 === `quantity`, 불일치 시 → `400 INVALID_SPECS_QUANTITY`

---

## 5. API 명세

모든 요청에 아래 헤더 필수:

```
X-User-Role: BUYER | SOURCING | MANUFACTURER
X-User-Id: {userId}
```

모든 응답은 아래 구조:

```json
{
  "success": true,
  "data": { ... }
}
```

에러 응답:

```json
{
  "success": false,
  "error": { "code": "ORDER_NOT_FOUND", "message": "발주서를 찾을 수 없습니다." }
}
```

---

### 발주서

#### `POST /orders` — 발주서 생성

권한: BUYER

Request Body:
```json
{
  "productName": "티셔츠",
  "quantity": 1000,
  "unitPrice": 15000,
  "specs": {
    "color": "white",
    "sizes": [
      { "size": "S", "quantity": 300 },
      { "size": "M", "quantity": 400 },
      { "size": "L", "quantity": 300 }
    ]
  },
  "deliveryDate": "2025-03-15",
  "buyerId": "buyer-001"
}
```

Response `201`:
```json
{
  "id": 1,
  "productName": "티셔츠",
  "quantity": 1000,
  "unitPrice": "15000.00",
  "specs": {
    "color": "white",
    "sizes": [
      { "size": "S", "quantity": 300 },
      { "size": "M", "quantity": 400 },
      { "size": "L", "quantity": 300 }
    ]
  },
  "deliveryDate": "2025-03-15",
  "status": "DRAFT",
  "currentVersion": 0,
  "buyerId": "buyer-001",
  "createdAt": "2025-02-10T00:00:00.000Z",
  "updatedAt": "2025-02-10T00:00:00.000Z"
}
```

---

#### `GET /orders/:id` — 발주서 현재 상태 조회

권한: BUYER, SOURCING, MANUFACTURER

Response `200`: 발주서 전체 필드 (POST 응답과 동일 구조)

---

#### `PATCH /orders/:id/confirm` — 발주서 확정

권한: SOURCING

Request Body: 없음

동작 (단일 트랜잭션):
1. `status` PENDING → CONFIRMED
2. `currentVersion` 0 → 1
3. `PurchaseOrderVersion` version=1 스냅샷 insert (`changeRequestId`: null)

Response `200`: 업데이트된 발주서

에러:
- 발주서 status가 PENDING이 아닌 경우 → `400 INVALID_STATUS_TRANSITION`

---

### 변경요청

#### `POST /orders/:id/change-requests` — 변경요청 생성

권한: BUYER

Request Body:
```json
{
  "reason": "생산 일정 조정으로 수량 및 납기 변경 필요",
  "changes": {
    "quantity": 1500,
    "deliveryDate": "2025-03-25"
  }
}
```

Response `201`:
```json
{
  "id": 1,
  "orderId": 1,
  "requestedBy": "buyer-001",
  "reason": "생산 일정 조정으로 수량 및 납기 변경 필요",
  "changes": { "quantity": 1500, "deliveryDate": "2025-03-25" },
  "status": "PENDING",
  "reviewedBy": null,
  "reviewComment": null,
  "createdAt": "2025-02-14T00:00:00.000Z",
  "reviewedAt": null
}
```

에러:
- 발주서 status가 CONFIRMED 미만 → `400 ORDER_NOT_CONFIRMED`
- 동일 발주서에 PENDING 변경요청 존재 → `409 CHANGE_REQUEST_ALREADY_PENDING`
- `changes` 필드 0개 → `400 CHANGES_REQUIRED`

---

#### `GET /orders/:id/change-requests` — 변경요청 목록 조회

권한: BUYER, SOURCING, MANUFACTURER

Response `200`:
```json
[
  {
    "id": 1,
    "orderId": 1,
    "requestedBy": "buyer-001",
    "reason": "...",
    "changes": { ... },
    "status": "APPROVED",
    "reviewedBy": "sourcing-001",
    "reviewComment": "승인합니다.",
    "createdAt": "2025-02-14T00:00:00.000Z",
    "reviewedAt": "2025-02-15T09:00:00.000Z"
  }
]
```

---

#### `PATCH /orders/:id/change-requests/:requestId/approve` — 변경요청 승인

권한: SOURCING

Request Body:
```json
{
  "reviewComment": "승인합니다."
}
```

동작 (단일 트랜잭션):
1. `ChangeRequest` status → APPROVED, reviewedBy, reviewComment, reviewedAt 기록
2. `PurchaseOrder` changes 필드 반영, `currentVersion` +1
3. `PurchaseOrderVersion` 스냅샷 insert (`changeRequestId`: 해당 변경요청 id)

Response `200`: 업데이트된 변경요청

에러:
- 변경요청 status가 PENDING이 아닌 경우 → `400 CHANGE_REQUEST_NOT_PENDING`

---

#### `PATCH /orders/:id/change-requests/:requestId/reject` — 변경요청 반려

권한: SOURCING

Request Body:
```json
{
  "reviewComment": "현재 생산 일정상 수량 증가 불가합니다."
}
```

동작:
1. `ChangeRequest` status → REJECTED, reviewedBy, reviewComment, reviewedAt 기록
2. `PurchaseOrder` 불변

Response `200`: 업데이트된 변경요청

에러:
- 변경요청 status가 PENDING이 아닌 경우 → `400 CHANGE_REQUEST_NOT_PENDING`

---

### 이력 조회

#### `GET /orders/:id/history` — 변경 이력 목록 조회

권한: BUYER, SOURCING, MANUFACTURER

Response `200`:
```json
[
  {
    "version": 1,
    "productName": "티셔츠",
    "quantity": 1000,
    "unitPrice": "15000.00",
    "specs": { "color": "white", "sizes": [{ "size": "S", "quantity": 300 }, { "size": "M", "quantity": 400 }, { "size": "L", "quantity": 300 }] },
    "deliveryDate": "2025-03-15",
    "changedBy": "sourcing-001",
    "reason": "초기 확정",
    "changeRequestId": null,
    "createdAt": "2025-02-10T00:00:00.000Z"
  },
  {
    "version": 2,
    "productName": "티셔츠",
    "quantity": 1500,
    "unitPrice": "15000.00",
    "specs": { "color": "white", "sizes": [{ "size": "S", "quantity": 300 }, { "size": "M", "quantity": 400 }, { "size": "L", "quantity": 300 }] },
    "deliveryDate": "2025-03-25",
    "changedBy": "sourcing-001",
    "reason": "생산 일정 조정으로 수량 및 납기 변경 필요",
    "changeRequestId": 1,
    "createdAt": "2025-02-15T09:00:00.000Z"
  }
]
```

---

#### `GET /orders/:id/versions/:version` — 특정 버전 조회

권한: BUYER, SOURCING, MANUFACTURER

Path param: `version` — 조회할 버전 번호 (양의 정수)

Response `200`: 해당 버전 스냅샷 전체 상태 (history 배열 원소와 동일 구조)

에러:
- 존재하지 않는 버전 → `404 VERSION_NOT_FOUND`

---

#### `GET /orders/:id/at?timestamp=ISO8601` — 특정 시점 조회

권한: BUYER, SOURCING, MANUFACTURER

Query param: `timestamp` — ISO 8601 형식 (예: `2025-02-16T10:00:00.000Z`)

동작: `WHERE orderId = :id AND createdAt <= :timestamp ORDER BY createdAt DESC LIMIT 1`

Response `200`: 해당 시점 기준 최신 스냅샷 전체 상태

에러:
- 해당 시점 이전 버전 없음 → `404 VERSION_NOT_FOUND`
- timestamp 형식 오류 → `400 INVALID_TIMESTAMP`

---

#### `GET /orders/:id/compare?from=1&to=3` — 버전 비교

권한: BUYER, SOURCING, MANUFACTURER

Query params: `from`, `to` — 비교할 버전 번호 (양의 정수)

Response `200`:
```json
{
  "from": 1,
  "to": 3,
  "diff": [
    { "field": "quantity", "before": 1000, "after": 1500 },
    { "field": "deliveryDate", "before": "2025-03-15", "after": "2025-03-25" }
  ]
}
```

동일 버전 비교 시 `"diff": []` 반환.

에러:
- from 또는 to 버전 존재하지 않음 → `404 VERSION_NOT_FOUND`

---

## 6. 예외 처리

| ErrorCode | HTTP | 메시지 |
|-----------|------|--------|
| `ORDER_NOT_FOUND` | 404 | 발주서를 찾을 수 없습니다. |
| `VERSION_NOT_FOUND` | 404 | 해당 버전을 찾을 수 없습니다. |
| `CHANGE_REQUEST_NOT_FOUND` | 404 | 변경요청을 찾을 수 없습니다. |
| `FORBIDDEN_ROLE` | 403 | 해당 작업에 대한 권한이 없습니다. |
| `INVALID_STATUS_TRANSITION` | 400 | 현재 상태에서 허용되지 않는 상태 전이입니다. |
| `ORDER_NOT_CONFIRMED` | 400 | 확정된 발주서에만 변경요청을 생성할 수 있습니다. |
| `CHANGE_REQUEST_ALREADY_PENDING` | 409 | 이미 처리 중인 변경요청이 있습니다. |
| `CHANGE_REQUEST_NOT_PENDING` | 400 | PENDING 상태의 변경요청만 승인/반려할 수 있습니다. |
| `CHANGES_REQUIRED` | 400 | 변경 항목이 1개 이상 필요합니다. |
| `INVALID_TIMESTAMP` | 400 | 유효하지 않은 timestamp 형식입니다. |
| `MISSING_ROLE_HEADER` | 400 | X-User-Role 헤더가 필요합니다. |
| `INVALID_SPECS_QUANTITY` | 400 | specs.sizes 수량 합계가 총 수량과 일치하지 않습니다. |

---

## 7. 모듈 구조

```
src/
  orders/
    orders.module.ts
    orders.controller.ts
    orders.service.ts
    dto/
      create-order.dto.ts
      confirm-order.dto.ts (body 없음, 경로용)
  change-requests/
    change-requests.module.ts
    change-requests.controller.ts
    change-requests.service.ts
    dto/
      create-change-request.dto.ts
      review-change-request.dto.ts    -- approve/reject 공용
  history/
    history.module.ts
    history.controller.ts
    history.service.ts
  common/
    guards/
      roles.guard.ts                  -- X-User-Role 헤더 검증
    decorators/
      roles.decorator.ts
    filters/
      http-exception.filter.ts
    enums/
      purchase-order-status.enum.ts
      change-request-status.enum.ts
  prisma/
    prisma.module.ts
    prisma.service.ts
```

---

## 8. 테스트 시나리오

### 변경 저장

- 변경요청 승인 시 `PurchaseOrderVersion` 스냅샷이 정확히 1행 생성되는지
- 수량 + 납기일 동시 변경 시 단일 버전(1행)으로 저장되는지
- 승인 트랜잭션 중 오류 발생 시 발주서/스냅샷/변경요청 전체 롤백되는지

### 이력 조회

- version=2 조회 → 1500벌, 2025-03-15 반환
- `timestamp=2025-02-16T10:00:00.000Z` 조회 → 버전2(1500벌, 2025-03-15) 반환
- 존재하지 않는 버전 조회 → 404

### 비교

- version 1 vs 3 비교 → diff에 `quantity`, `deliveryDate`만 포함
- 동일 버전(1 vs 1) 비교 → `diff: []`

### 비즈니스 규칙

- CONFIRMED 미만 발주서에 변경요청 생성 → 400
- PENDING 변경요청 존재 시 신규 변경요청 → 409
- BUYER가 승인 요청 → 403
- `changes: {}` 로 변경요청 생성 → 400

### 통합 시나리오

- 발주서 생성(DRAFT) → 확정(CONFIRMED + 버전1) → 변경요청 생성 → 승인(버전2) → 이력 조회 2건 → 버전 비교 정상 동작

---

## 9. 산출물 매핑

| 과제 제출물 | 구현 대상 |
|-----------|---------|
| 소스코드 (NestJS) | `orders`, `change-requests`, `history` 모듈 + Prisma 스키마 |
| DESIGN.md | 이력 관리 전략 상세 — 스냅샷-only 선택 근거, 대안 비교, 구현 상세 |
| README.md | 실행 방법, 환경 설정, API 명세 요약, 테스트 실행 방법 |
| 테스트 코드 | Jest 단위 테스트 (서비스 레이어) + E2E 테스트 (전체 플로우) |

**Definition of Done:**
- [ ] 이력 조회 4종 API 모두 동작
- [ ] 승인 트랜잭션 롤백 동작 확인
- [ ] 비즈니스 규칙 검증(권한, 상태, 중복) 동작
- [ ] DESIGN.md 완성 (이력 전략 + 의사결정 + 구현 상세)
- [ ] 테스트 시나리오 전체 통과
