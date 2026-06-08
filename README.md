# 발주서 변경 승인 프로세스 API

의류 생산 발주서의 주문자 변경 요청 → 소싱팀 승인 → 발주서 반영 프로세스를 구현한 NestJS 백엔드 서버입니다.

## 기술 스택

- **NestJS 11** / TypeScript
- **Prisma 7** (MariaDB 어댑터)
- **MySQL 8**
- **Jest** (단위 테스트)
- **Swagger** (API 문서)
- **Docker** (실행 환경)

---

## 실행 방법

### 방법 1. Docker (권장)

`.env` 파일만 준비하면 앱과 DB가 함께 기동됩니다. 컨테이너 기동 시 DB 마이그레이션이 자동 적용됩니다.

```bash
cp .env.example .env
docker compose up --build
```

### 방법 2. 로컬 실행

```bash
# 1. 의존성 설치
yarn install

# 2. 환경변수 설정
cp .env.example .env

# 3. DB 실행 (Docker)
docker compose up mysql -d

# 4. 마이그레이션 적용
yarn prisma migrate dev

# 5. 개발 서버 실행 (watch 모드)
yarn start:dev
```

---

## 환경 설정

`.env.example`을 복사해 `.env`를 생성합니다.

| 변수 | 설명 | 예시 |
|------|------|------|
| `DATABASE_URL` | Prisma 마이그레이션용 연결 문자열 | `mysql://root:password@localhost:3306/sije_db` |
| `DB_HOST` | MariaDB 어댑터 호스트 | `localhost` |
| `DB_PORT` | 포트 | `3306` |
| `DB_NAME` | 데이터베이스명 | `sije_db` |
| `DB_USER` | 사용자 | `root` |
| `DB_PASSWORD` | 비밀번호 | `password` |
| `PORT` | 앱 포트 | `3000` |

---

## API 명세

Swagger UI: `http://localhost:3000/api`

모든 요청에 다음 헤더가 필요합니다.

| 헤더 | 설명 | 가능한 값 |
|------|------|-----------|
| `X-User-Id` | 사용자 ID | 임의 문자열 |
| `X-User-Role` | 사용자 역할 | `BUYER` / `SOURCING` / `MANUFACTURER` |

### 발주서

#### `POST /orders` — 발주서 생성 `BUYER`

```json
// Request
{
  "productName": "반팔 티셔츠 A형",
  "quantity": 100,
  "unitPrice": 5000,
  "specs": {
    "color": "white",
    "sizes": [
      { "size": "S", "quantity": 30 },
      { "size": "M", "quantity": 40 },
      { "size": "L", "quantity": 30 }
    ]
  },
  "deliveryDate": "2025-12-01",
  "buyerId": "buyer-uuid-1234",
  "status": "PENDING"
}

// Response 201
{
  "id": 1,
  "productName": "반팔 티셔츠 A형",
  "quantity": 100,
  "unitPrice": "5000",
  "specs": { "color": "white", "sizes": [...] },
  "deliveryDate": "2025-12-01T00:00:00.000Z",
  "status": "PENDING",
  "currentVersion": 0,
  "buyerId": "buyer-uuid-1234",
  "createdAt": "2025-10-01T09:00:00.000Z",
  "updatedAt": "2025-10-01T09:00:00.000Z"
}
```

#### `GET /orders/:id` — 발주서 단건 조회 `ALL`

```json
// Response 200
{
  "id": 1,
  "productName": "반팔 티셔츠 A형",
  "quantity": 100,
  "unitPrice": "5000",
  "specs": { "color": "white", "sizes": [...] },
  "deliveryDate": "2025-12-01T00:00:00.000Z",
  "status": "CONFIRMED",
  "currentVersion": 1,
  "buyerId": "buyer-uuid-1234",
  "createdAt": "2025-10-01T09:00:00.000Z",
  "updatedAt": "2025-10-01T10:00:00.000Z"
}
```

#### `PATCH /orders/:id/confirm` — 발주서 확정 `SOURCING`

```json
// Request Body 없음

// Response 200 — 확정된 발주서 반환 (status: CONFIRMED, currentVersion: 1)
```

#### `PATCH /orders/:id/start-production` — 생산 시작 `SOURCING, MANUFACTURER`

```json
// Request Body 없음

// Response 200 — status: IN_PRODUCTION으로 변경된 발주서 반환
```

#### `PATCH /orders/:id/complete` — 완료 처리 `SOURCING, MANUFACTURER`

```json
// Request Body 없음

// Response 200 — status: COMPLETED로 변경된 발주서 반환
```

---

### 변경요청

#### `POST /orders/:id/change-requests` — 변경요청 생성 `BUYER`

```json
// Request
{
  "reason": "생산 일정 조정으로 납기일 연장 요청합니다.",
  "changes": {
    "quantity": 150,
    "deliveryDate": "2025-12-15"
  }
}

// Response 201
{
  "id": 1,
  "orderId": 1,
  "requestedBy": "buyer-uuid-1234",
  "reason": "생산 일정 조정으로 납기일 연장 요청합니다.",
  "changes": { "quantity": 150, "deliveryDate": "2025-12-15" },
  "status": "PENDING",
  "reviewedBy": null,
  "reviewComment": null,
  "createdAt": "2025-10-05T09:00:00.000Z",
  "reviewedAt": null
}
```

#### `GET /orders/:id/change-requests` — 변경요청 목록 조회 `ALL`

```json
// Response 200
[
  {
    "id": 1,
    "orderId": 1,
    "requestedBy": "buyer-uuid-1234",
    "reason": "생산 일정 조정으로 납기일 연장 요청합니다.",
    "changes": { "quantity": 150, "deliveryDate": "2025-12-15" },
    "status": "APPROVED",
    "reviewedBy": "sourcing-uuid-5678",
    "reviewComment": "승인합니다.",
    "createdAt": "2025-10-05T09:00:00.000Z",
    "reviewedAt": "2025-10-06T10:00:00.000Z"
  }
]
```

#### `PATCH /orders/:id/change-requests/:requestId/approve` — 변경요청 승인 `SOURCING`

```json
// Request
{
  "reviewComment": "납기일 연장 승인합니다."
}

// Response 200 — status: APPROVED로 변경된 변경요청 반환
```

#### `PATCH /orders/:id/change-requests/:requestId/reject` — 변경요청 반려 `SOURCING`

```json
// Request
{
  "reviewComment": "현재 생산 일정상 수량 변경이 어렵습니다."
}

// Response 200 — status: REJECTED로 변경된 변경요청 반환
```

---

### 이력 조회

#### `GET /orders/:id/history` — 전체 버전 이력 조회 `ALL`

```json
// Response 200
[
  {
    "id": 1,
    "orderId": 1,
    "version": 1,
    "productName": "반팔 티셔츠 A형",
    "quantity": 100,
    "unitPrice": "5000",
    "specs": { "color": "white", "sizes": [{ "size": "S", "quantity": 30 }, { "size": "M", "quantity": 40 }, { "size": "L", "quantity": 30 }] },
    "deliveryDate": "2025-12-01T00:00:00.000Z",
    "changedBy": "sourcing-uuid-5678",
    "reason": "초기 확정",
    "changeRequestId": null,
    "createdAt": "2025-10-01T10:00:00.000Z"
  },
  {
    "id": 2,
    "orderId": 1,
    "version": 2,
    "productName": "반팔 티셔츠 A형",
    "quantity": 150,
    "unitPrice": "5000",
    "specs": { "color": "white", "sizes": [{ "size": "S", "quantity": 30 }, { "size": "M", "quantity": 40 }, { "size": "L", "quantity": 30 }] },
    "deliveryDate": "2025-12-15T00:00:00.000Z",
    "changedBy": "sourcing-uuid-5678",
    "reason": "생산 일정 조정으로 납기일 연장 요청합니다.",
    "changeRequestId": 1,
    "createdAt": "2025-10-06T10:00:00.000Z"
  }
]
```

#### `GET /orders/:id/versions/:version` — 특정 버전 스냅샷 조회 `ALL`

```json
// GET /orders/1/versions/2
// Response 200
{
  "id": 2,
  "orderId": 1,
  "version": 2,
  "productName": "반팔 티셔츠 A형",
  "quantity": 150,
  "unitPrice": "5000",
  "specs": { "color": "white", "sizes": [...] },
  "deliveryDate": "2025-12-15T00:00:00.000Z",
  "changedBy": "sourcing-uuid-5678",
  "reason": "생산 일정 조정으로 납기일 연장 요청합니다.",
  "changeRequestId": 1,
  "createdAt": "2025-10-06T10:00:00.000Z"
}
```

#### `GET /orders/:id/at?timestamp=` — 특정 시점 스냅샷 조회 `ALL`

```json
// GET /orders/1/at?timestamp=2025-10-03T00:00:00.000Z
// Response 200 — 해당 시점 이전 가장 최신 버전(버전1) 반환
{
  "id": 1,
  "version": 1,
  "quantity": 100,
  "deliveryDate": "2025-12-01T00:00:00.000Z",
  ...
}
```

#### `GET /orders/:id/compare?from=&to=` — 두 버전 간 비교 `ALL`

```json
// GET /orders/1/compare?from=1&to=2
// Response 200
{
  "diff": [
    {
      "field": "quantity",
      "before": 100,
      "after": 150
    },
    {
      "field": "deliveryDate",
      "before": "2025-12-01T00:00:00.000Z",
      "after": "2025-12-15T00:00:00.000Z"
    }
  ]
}
```

#### `GET /orders/:id/status-history` — 상태 전이 이력 조회 `ALL`

```json
// Response 200
[
  {
    "id": 1,
    "orderId": 1,
    "fromStatus": "PENDING",
    "toStatus": "CONFIRMED",
    "changedBy": "sourcing-uuid-5678",
    "createdAt": "2025-10-01T10:00:00.000Z"
  },
  {
    "id": 2,
    "orderId": 1,
    "fromStatus": "CONFIRMED",
    "toStatus": "IN_PRODUCTION",
    "changedBy": "sourcing-uuid-5678",
    "createdAt": "2025-10-10T09:00:00.000Z"
  }
]
```

---

## 테스트

```bash
# 단위 테스트
yarn test

# 커버리지 포함
yarn test:cov

# 특정 파일만
yarn test --testPathPattern=orders.service
```

---

## 발주서 상태 흐름

```
DRAFT → PENDING → CONFIRMED → IN_PRODUCTION → COMPLETED
                     ↑
              변경요청 가능 구간
```

| 상태 | 설명 |
|------|------|
| `DRAFT` | 주문자 작성 중 |
| `PENDING` | 소싱팀 검토 대기 |
| `CONFIRMED` | 확정 (변경요청 가능) |
| `IN_PRODUCTION` | 생산 진행 중 |
| `COMPLETED` | 납품 완료 |
