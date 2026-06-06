# Development Guidelines

## Project Overview

- **목적**: 의류 생산 발주서 변경 승인 프로세스 API (NestJS 11 + Prisma 7 + MySQL 8)
- **핵심 기능**: 발주서 CRUD, 변경요청 승인/반려, 변경 이력 조회 4종
- **이력 전략**: 스냅샷-only (`PurchaseOrderVersion` 테이블, 델타 테이블 없음)
- **권한 처리**: `X-User-Role` / `X-User-Id` 헤더 기반 mock Guard (JWT 없음)
- **스펙 문서**: `docs/PRD.md` — API 명세·데이터 모델·비즈니스 규칙의 단일 진실원천

---

## Project Architecture

```
src/
  orders/              # 발주서 생성·조회·확정
  change-requests/     # 변경요청 생성·승인·반려
  history/             # 이력 조회 4종 (이력목록/특정버전/특정시점/버전비교)
  common/
    guards/            # RolesGuard (X-User-Role 헤더 검증)
    decorators/        # @Roles() 데코레이터
    filters/           # HttpExceptionFilter
    enums/             # PurchaseOrderStatus, ChangeRequestStatus
  prisma/              # PrismaModule (글로벌), PrismaService
  app.module.ts        # 루트 모듈 — 새 모듈은 반드시 여기에 import
  main.ts              # 부트스트랩 (ValidationPipe·Swagger 설정 완료)
prisma/
  schema.prisma        # 모델 정의. datasource에 url 없음 (prisma.config.ts 주입)
docs/
  PRD.md               # 전체 스펙 — API/모델/규칙 변경 시 이 파일 먼저 확인
```

---

## Prisma 규칙

### Import 경로
- PrismaClient import: **반드시** `'../generated/prisma/client'` 사용
  - ✅ `import { PrismaClient } from '../generated/prisma/client'`
  - ❌ `import { PrismaClient } from '@prisma/client'`

### schema.prisma 수정 규칙
- `datasource db`에 `url` 필드 **추가 금지** — `prisma.config.ts`가 런타임에 주입
- 모델 추가/변경 후 반드시 아래 순서 실행:
  1. `yarn prisma migrate dev`
  2. `yarn prisma generate`
- `src/generated/prisma/` 디렉토리 **직접 수정 금지** (자동 생성 파일)

### Prisma 스키마 (docs/PRD.md 섹션 4 기준)
새 모델 추가 시 아래 3개 테이블 구조를 준수한다:

| 테이블 | 역할 |
|--------|------|
| `PurchaseOrder` | 현재 발주서 상태 |
| `PurchaseOrderVersion` | 버전별 전체 상태 스냅샷 |
| `ChangeRequest` | 변경요청 및 검토 결과 |

- `PurchaseOrderVersion`: `@@unique([orderId, version])` + `@@index([orderId, createdAt])` 필수
- `ChangeRequest.changes`: `Json` 타입, 서비스에서 `Object.keys(changes).length >= 1` 검증
- `PurchaseOrder.specs`: **strict DTO** — `color`(string 필수), `sizes`(Array 필수) 만 허용. 그 외 필드는 `forbidNonWhitelisted`로 자동 400. 새 항목 필요 시 `SpecsDto`에 필드 추가. `sum(sizes[].quantity) === quantity` 검증 필수, 불일치 시 `INVALID_SPECS_QUANTITY` (400)

---

## 이력 관리 규칙

- **스냅샷-only 전략** — 변경 승인 시마다 발주서 전체 상태를 `PurchaseOrderVersion`에 저장
- **델타 테이블 추가 금지** — 변경분(diff) 전용 테이블을 별도로 만들지 않는다
- 버전 비교(`compare`)는 두 스냅샷을 서비스 레이어에서 필드별 런타임 diff로 처리

### 버전 생성 시점
| 이벤트 | 버전 | `changeRequestId` |
|--------|------|-------------------|
| 발주서 CONFIRMED 전환 | 1 | `null` |
| 변경요청 승인 | currentVersion + 1 | 해당 ChangeRequest.id |

---

## 트랜잭션 규칙

- **발주서 확정** (`PATCH /orders/:id/confirm`): 단일 `$transaction()` 내에서
  1. `PurchaseOrder.status` PENDING → CONFIRMED, `currentVersion` 0 → 1
  2. `PurchaseOrderVersion` version=1 스냅샷 insert
- **변경요청 승인** (`PATCH .../approve`): 단일 `$transaction()` 내에서
  1. `ChangeRequest` status → APPROVED, reviewedBy/reviewComment/reviewedAt 기록
  2. `PurchaseOrder` changes 필드 반영, `currentVersion` +1
  3. `PurchaseOrderVersion` 새 버전 스냅샷 insert
- 트랜잭션 중 오류 시 전체 롤백 — `try/catch` 후 Prisma 자동 롤백 의존

---

## 권한(Guard) 규칙

- 모든 요청에 `X-User-Role` (BUYER | SOURCING | MANUFACTURER), `X-User-Id` 헤더 필수
- `RolesGuard`를 글로벌 또는 컨트롤러 레벨에 적용, `@Roles()` 데코레이터로 허용 역할 지정
- **JWT·세션 인증 구현 금지** — 헤더 값을 그대로 신뢰
- 헤더 누락 시 400 `MISSING_ROLE_HEADER`, 권한 없는 역할 시 403 `FORBIDDEN_ROLE`

### 역할별 허용 작업

| 엔드포인트 | BUYER | SOURCING | MANUFACTURER |
|-----------|-------|----------|--------------|
| POST /orders | ✅ | ❌ | ❌ |
| GET /orders/:id | ✅ | ✅ | ✅ |
| PATCH /orders/:id/confirm | ❌ | ✅ | ❌ |
| POST /orders/:id/change-requests | ✅ | ❌ | ❌ |
| GET /orders/:id/change-requests | ✅ | ✅ | ✅ |
| PATCH .../approve | ❌ | ✅ | ❌ |
| PATCH .../reject | ❌ | ✅ | ❌ |
| GET /orders/:id/history | ✅ | ✅ | ✅ |
| GET /orders/:id/versions/:v | ✅ | ✅ | ✅ |
| GET /orders/:id/at | ✅ | ✅ | ✅ |
| GET /orders/:id/compare | ✅ | ✅ | ✅ |

---

## 비즈니스 규칙

### 변경요청 생성 조건 (모두 충족해야 함)
1. 요청자 역할: BUYER
2. 발주서 status: CONFIRMED, IN_PRODUCTION, COMPLETED 중 하나 (DRAFT/PENDING 불가)
3. 동일 발주서에 PENDING 변경요청 없음
4. `changes` 필드 1개 이상

### 승인/반려 조건
- 요청자 역할: SOURCING
- 변경요청 status: PENDING

### 상태 전이
```
PurchaseOrder:  DRAFT → PENDING → CONFIRMED → IN_PRODUCTION → COMPLETED
ChangeRequest:  PENDING → APPROVED | REJECTED
```
- 역방향 전이 금지
- CONFIRMED 미만 발주서에 변경요청 → 400 `ORDER_NOT_CONFIRMED`
- PENDING 변경요청 존재 시 신규 변경요청 → 409 `CHANGE_REQUEST_ALREADY_PENDING`

---

## 에러 코드 규칙

`docs/PRD.md` 섹션 6의 ErrorCode를 그대로 사용한다. 임의 에러 코드 추가 금지.

| ErrorCode | HTTP |
|-----------|------|
| `ORDER_NOT_FOUND` | 404 |
| `VERSION_NOT_FOUND` | 404 |
| `CHANGE_REQUEST_NOT_FOUND` | 404 |
| `FORBIDDEN_ROLE` | 403 |
| `INVALID_STATUS_TRANSITION` | 400 |
| `ORDER_NOT_CONFIRMED` | 400 |
| `CHANGE_REQUEST_ALREADY_PENDING` | 409 |
| `CHANGE_REQUEST_NOT_PENDING` | 400 |
| `CHANGES_REQUIRED` | 400 |
| `INVALID_TIMESTAMP` | 400 |
| `MISSING_ROLE_HEADER` | 400 |

에러 응답 구조:
```json
{ "success": false, "error": { "code": "ORDER_NOT_FOUND", "message": "..." } }
```

---

## NestJS 코드 규칙

### ValidationPipe
- `main.ts`에 글로벌 설정 완료 (`whitelist: true, transform: true, forbidNonWhitelisted: true`)
- 모듈/컨트롤러에 **중복 등록 금지**

### Swagger
- `main.ts`에 설정 완료, 경로 `/api`
- 컨트롤러에 `@ApiTags()`, DTO에 `@ApiProperty()` 적용

### 모듈 등록
- 새 도메인 모듈 생성 시 `src/app.module.ts`의 `imports`에 반드시 추가
- `PrismaModule`은 `@Global()`로 선언됨 — 개별 모듈에 재import 불필요

### DTO 규칙
- 모든 DTO는 `class-validator` 데코레이터 사용
- `changes` 필드 DTO: `@IsObject()` + 커스텀 검증으로 빈 객체 거부
- 요청 DTO와 응답 DTO 분리

### 파일 생성 위치
| 파일 유형 | 경로 |
|----------|------|
| 발주서 모듈 | `src/orders/` |
| 변경요청 모듈 | `src/change-requests/` |
| 이력 조회 모듈 | `src/history/` |
| 공통 Guard | `src/common/guards/roles.guard.ts` |
| 공통 데코레이터 | `src/common/decorators/roles.decorator.ts` |
| 공통 필터 | `src/common/filters/http-exception.filter.ts` |
| Enum | `src/common/enums/` |

---

## 금지 사항

- ❌ `src/generated/prisma/` 파일 직접 수정
- ❌ `prisma/schema.prisma`의 `datasource db`에 `url` 필드 추가
- ❌ 델타(diff) 전용 테이블 추가 (이력 전략: 스냅샷-only)
- ❌ JWT·세션 기반 인증 구현
- ❌ 동시성 제어 (낙관적/비관적 잠금) 구현
- ❌ 캐싱 레이어 구현
- ❌ `PRD.md`에 없는 에러 코드 신규 추가
- ❌ `ValidationPipe` 중복 등록
- ❌ `PrismaModule` 개별 모듈에 재import
- ❌ `@prisma/client`에서 직접 import (반드시 `'../generated/prisma/client'` 사용)
