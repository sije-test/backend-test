# ROADMAP

> PRD 기반 개발 로드맵 | 생성일: 2026-06-06

## 개요

의류 생산 발주서의 변경 요청 → 소싱팀 승인 → 발주서 반영 프로세스를 NestJS 11 + Prisma 7 (MariaDB 어댑터) 기반으로 구현한다. 스냅샷-only 이력 전략으로 모든 변경 이력을 완전히 보존하고, 버전 조회·시점 조회·버전 비교 4종 이력 API를 제공한다. 역할 기반 접근 제어(BUYER / SOURCING / MANUFACTURER)는 헤더 mock 방식으로 처리한다.

## 전제 조건

- 로컬 인프라 기동 상태 확인
  - MySQL 8: `docker-compose up mysql -d`
  - 접속 확인: `mysql -h 127.0.0.1 -P 3306 -u root -p sije_db`
- `.env` 파일 설정 완료 (`.env.example` 참고)
- 브랜치 전략: `feature/기능명`
- 빌드 검증: `yarn build`

---

## Phase 1. 아키텍처 설정 — Prisma 스키마 & 마이그레이션

### 1-1. Prisma 스키마 작성 및 마이그레이션

- **목적**: 세 테이블(`PurchaseOrder`, `PurchaseOrderVersion`, `ChangeRequest`)과 두 enum을 DB에 반영하고 Prisma 클라이언트를 생성한다.
- **브랜치**: `feature/prisma-schema`
- **작업 내용**:
  - [x] `prisma/schema.prisma`에 아래 내용을 추가한다.
    - enum `PurchaseOrderStatus` (DRAFT / PENDING / CONFIRMED / IN_PRODUCTION / COMPLETED)
    - enum `ChangeRequestStatus` (PENDING / APPROVED / REJECTED)
    - model `PurchaseOrder` — `id`, `productName`, `quantity`, `unitPrice Decimal @db.Decimal(12,2)`, `specs Json`, `deliveryDate DateTime @db.Date`, `status`, `currentVersion Int @default(0)`, `buyerId`, `createdAt`, `updatedAt @updatedAt`, 관계 필드
    - model `PurchaseOrderVersion` — `id`, `orderId`, `version`, `productName`, `quantity`, `unitPrice`, `specs`, `deliveryDate`, `changedBy`, `reason`, `changeRequestId Int?`, `createdAt`, 관계 필드, `@@unique([orderId, version])`, `@@index([orderId, createdAt])`
    - model `ChangeRequest` — `id`, `orderId`, `requestedBy`, `reason`, `changes Json`, `status`, `reviewedBy String?`, `reviewComment String?`, `createdAt`, `reviewedAt DateTime?`, 관계 필드
    - model `OrderStatusLog` — `id`, `orderId @map("order_id")`, `fromStatus @map("from_status")`, `toStatus @map("to_status")`, `changedBy @map("changed_by")`, `createdAt @map("created_at")`, 관계 필드, `@@index([orderId, createdAt])`, `@@map("order_status_logs")`
  - [x] 마이그레이션 실행 및 클라이언트 생성
    ```bash
    yarn prisma migrate dev --name init-schema
    yarn prisma generate
    ```
  - [x] `src/generated/prisma/client` 경로에 클라이언트가 생성되었는지 확인

- **완료 기준**: `yarn prisma migrate dev` 성공, `src/generated/prisma/client` 디렉터리에 `PrismaClient` 타입이 `PurchaseOrder`, `PurchaseOrderVersion`, `ChangeRequest`, `OrderStatusLog` 모델을 모두 포함함.
- **검증**:
  ```bash
  yarn build
  ```

---

## Phase 2. 공통 모듈

### 2-1. ErrorCode 정의 및 HttpExceptionFilter

- **목적**: 12개 에러 코드와 `{ success: false, error: { code, message } }` 응답 구조를 전역 필터로 통일한다.
- **브랜치**: `feature/common`
- **작업 내용**:
  - [x] `src/common/constants/error-code.const.ts` 생성
    - 에러 코드와 HTTP 상태코드·메시지를 매핑하는 `ErrorCode` enum 또는 const map 작성
    - 포함 코드: `ORDER_NOT_FOUND(404)`, `VERSION_NOT_FOUND(404)`, `CHANGE_REQUEST_NOT_FOUND(404)`, `FORBIDDEN_ROLE(403)`, `INVALID_STATUS_TRANSITION(400)`, `ORDER_NOT_CONFIRMED(400)`, `CHANGE_REQUEST_ALREADY_PENDING(409)`, `CHANGE_REQUEST_NOT_PENDING(400)`, `CHANGES_REQUIRED(400)`, `INVALID_TIMESTAMP(400)`, `MISSING_ROLE_HEADER(400)`, `INVALID_SPECS_QUANTITY(400)`
  - [x] `src/common/filters/http-exception.filter.ts` 생성
    - `ExceptionFilter` 구현, `HttpException`을 `{ success: false, error: { code, message } }` 형태로 변환
    - 알 수 없는 예외는 `500 INTERNAL_SERVER_ERROR`로 처리
  - [x] `src/main.ts`에 `HttpExceptionFilter` 전역 등록 (`app.useGlobalFilters`)

- **완료 기준**: 존재하지 않는 경로 요청 시 `{ "success": false, "error": { "code": "...", "message": "..." } }` 구조로 응답.
- **검증**:
  ```bash
  yarn build
  ```

### 2-2. 역할 기반 Guard 및 Decorator

- **목적**: `X-User-Role` / `X-User-Id` 헤더를 읽어 권한을 검증하는 `RolesGuard`와 `@Roles()` 데코레이터를 작성한다.
- **작업 내용**:
  - [x] `src/common/enums/purchase-order-status.enum.ts` 생성 — `PurchaseOrderStatus` enum (Prisma enum과 값 일치)
  - [x] `src/common/enums/change-request-status.enum.ts` 생성 — `ChangeRequestStatus` enum
  - [x] `src/common/enums/role.enum.ts` 생성 — `Role` enum (BUYER / SOURCING / MANUFACTURER)
  - [x] `src/common/decorators/roles.decorator.ts` 생성 — `@Roles(...roles: Role[])` 메타데이터 데코레이터
  - [x] `src/common/guards/roles.guard.ts` 생성
    - `X-User-Role` 헤더 누락 시 `400 MISSING_ROLE_HEADER`
    - 허용되지 않은 역할 시 `403 FORBIDDEN_ROLE`
    - `X-User-Id` 헤더는 request에 주입 (서비스에서 사용)
  - [x] `src/common/common.module.ts` 생성 — Guard·Filter export

- **완료 기준**: `@Roles(Role.BUYER)` 가드가 붙은 엔드포인트에 `X-User-Role: SOURCING`으로 요청 시 403 반환.
- **검증**:
  ```bash
  yarn test --testPathPattern=roles.guard
  ```

### 2-3. 공통 DTO — SpecsDto / SizeItemDto

- **목적**: `orders`와 `change-requests` 모듈에서 공용으로 사용하는 specs 관련 DTO를 `common/dto`에 작성한다.
- **작업 내용**:
  - [x] `src/common/dto/size-item.dto.ts` 생성
    - `size: string` — `@IsString()`, `@IsNotEmpty()`
    - `quantity: number` — `@IsInt()`, `@Min(1)`
  - [x] `src/common/dto/specs.dto.ts` 생성
    - `color: string` — `@IsString()`, `@IsNotEmpty()`
    - `sizes: SizeItemDto[]` — `@IsArray()`, `@ValidateNested({ each: true })`, `@Type(() => SizeItemDto)`
    - `color`, `sizes` 외 필드는 `ValidationPipe`의 `forbidNonWhitelisted`로 자동 400
  - [x] specs 수량 검증 로직을 서비스 레이어용 헬퍼 함수로 분리 고려
    - `validateSpecsQuantity(specs: SpecsDto, quantity: number): void` — 불일치 시 `INVALID_SPECS_QUANTITY` throw

- **완료 기준**: `color` 누락, `sizes` 누락, 허용 외 필드 포함 요청 모두 400 반환. `sizes` 합계 !== `quantity`이면 서비스에서 400 반환.
- **검증**:
  ```bash
  yarn test --testPathPattern=specs.dto
  ```

### 2-4. 공통 DTO — ChangesDto

- **목적**: 변경요청의 `changes` 필드에 대한 타입 안전한 검증을 `ChangesDto`로 처리한다. `forbidNonWhitelisted`로 허용 외 필드를 자동 400 처리하며, 새 변경 가능 항목은 이 DTO에 필드를 추가하여 확장한다.
- **작업 내용**:
  - [x] `src/common/dto/changes.dto.ts` 생성
    - `quantity?: number` — `@IsOptional()`, `@IsInt()`, `@Min(1)`
    - `productName?: string` — `@IsOptional()`, `@IsString()`, `@IsNotEmpty()`
    - `unitPrice?: number` — `@IsOptional()`, `@IsNumber()`, `@Min(0)`
    - `deliveryDate?: string` — `@IsOptional()`, `@IsDateString()`
    - `specs?: SpecsDto` — `@IsOptional()`, `@ValidateNested()`, `@Type(() => SpecsDto)`
    - `ValidationPipe`의 `forbidNonWhitelisted`로 허용 외 필드 포함 요청 자동 400 처리

- **완료 기준**: 허용 외 필드 포함 시 400, `specs` 포함 시 `SpecsDto` 중첩 검증 동작.
- **검증**:
  ```bash
  yarn test --testPathPattern=changes.dto
  ```

---

## Phase 3. orders 모듈

### 3-1. orders — DTO 및 Service

- **목적**: 발주서 생성·조회·확정 비즈니스 로직을 구현한다. 확정 시 단일 트랜잭션으로 버전1 스냅샷을 생성한다.
- **브랜치**: `feature/orders`
- **작업 내용**:
  - [x] `src/orders/dto/create-order.dto.ts` 생성
    - `productName: string` — `@IsString()`, `@IsNotEmpty()`
    - `quantity: number` — `@IsInt()`, `@Min(1)`
    - `unitPrice: number` — `@IsNumber()`, `@Min(0)`
    - `specs: SpecsDto` — `@ValidateNested()`, `@Type(() => SpecsDto)` (공통 DTO 사용)
    - `deliveryDate: string` — `@IsDateString()`
    - `buyerId: string` — `@IsString()`, `@IsNotEmpty()`
    - `status?: PurchaseOrderStatus` — `@IsOptional()`, `@IsEnum(PurchaseOrderStatus)`, 허용 값: `DRAFT` | `PENDING`, 기본값 `DRAFT`
      - 생략 시 DRAFT(임시저장), `PENDING` 명시 시 소싱팀 검토 요청 상태로 생성
  - [x] `src/orders/orders.service.ts` 생성
    - `createOrder(dto, userId)`: specs 수량 검증 → `prisma.purchaseOrder.create` → 발주서 반환
    - `findOrderById(id)`: 존재하지 않으면 `ORDER_NOT_FOUND(404)` throw
    - `confirmOrder(id, userId)`: 단일 트랜잭션
      - status가 PENDING이 아니면 `INVALID_STATUS_TRANSITION(400)` throw
      - `prisma.$transaction`: status → CONFIRMED, currentVersion → 1, `purchaseOrderVersion.create` (version=1, changeRequestId=null, reason="초기 확정", changedBy=userId), `orderStatusLog.create` (fromStatus=PENDING, toStatus=CONFIRMED, changedBy=userId)
      - 업데이트된 발주서 반환
  - [x] `src/orders/orders.module.ts` 생성 — `PrismaModule`, `CommonModule` import

- **완료 기준**: 각 메서드가 정상 케이스와 예외 케이스 모두 처리.
- **테스트**:
  - [x] `createOrder` 정상 케이스 — 발주서 생성, specs 합계 불일치 400
  - [x] `findOrderById` 존재하지 않는 id → 404
  - [x] `confirmOrder` 정상 케이스 — 트랜잭션 호출, 버전1 스냅샷 생성 및 `OrderStatusLog` 1행 insert 검증
  - [x] `confirmOrder` PENDING 아닌 상태 → 400 INVALID_STATUS_TRANSITION
  ```bash
  yarn test --testPathPattern=orders.service
  ```

### 3-2. orders — Controller

- **목적**: 발주서 API 3종을 Controller로 노출하고 Swagger 어노테이션을 추가한다.
- **작업 내용**:
  - [x] `src/orders/orders.controller.ts` 생성
    - `POST /orders` — `@Roles(Role.BUYER)`, `@HttpCode(201)`, body: `CreateOrderDto`, `X-User-Id` 헤더에서 userId 추출
    - `GET /orders/:id` — 전체 역할 허용 (`@Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)`)
    - `PATCH /orders/:id/confirm` — `@Roles(Role.SOURCING)`, body 없음
    - 모든 응답 `{ success: true, data: ... }` 래핑 (전역 TransformInterceptor)
    - `@ApiTags('orders')`, `@ApiHeader` (X-User-Role, X-User-Id) Swagger 어노테이션
  - [x] `AppModule`에 `OrdersModule` import (기완료)

- **완료 기준**: Swagger UI에서 3개 엔드포인트 확인, 권한 위반 시 403 반환.
- **테스트**:
  - [x] `POST /orders` BUYER 역할 정상 생성 → 201
  - [ ] `POST /orders` SOURCING 역할 → 403 (E2E Phase 7에서 검증)
  - [x] `PATCH /orders/:id/confirm` SOURCING 역할 정상 → 200, 버전1 스냅샷 생성
  - [ ] `PATCH /orders/:id/confirm` BUYER 역할 → 403 (E2E Phase 7에서 검증)
  ```bash
  yarn test --testPathPattern=orders.controller
  ```

---

## Phase 4. change-requests 모듈

### 4-1. change-requests — DTO 및 Service

- **목적**: 변경요청 생성·승인·반려 비즈니스 로직을 구현한다. 승인 시 단일 트랜잭션으로 발주서 업데이트와 스냅샷 생성을 원자적으로 처리한다.
- **브랜치**: `feature/change-requests`
- **작업 내용**:
  - [x] `src/change-requests/dto/create-change-request.dto.ts` 생성
    - `reason: string` — `@IsString()`, `@IsNotEmpty()`
    - `changes: ChangesDto` — `@ValidateNested()`, `@Type(() => ChangesDto)` (공통 DTO 사용, specs 포함 시 SpecsDto 중첩 자동 검증)
  - [x] `src/change-requests/dto/review-change-request.dto.ts` 생성 (approve/reject 공용)
    - `reviewComment: string` — `@IsString()`, `@IsOptional()`
  - [x] `src/change-requests/change-requests.service.ts` 생성
    - `createChangeRequest(orderId, dto, userId)`:
      - `findOrderById` 호출 (ORDER_NOT_FOUND 위임)
      - status < CONFIRMED이면 `ORDER_NOT_CONFIRMED(400)` throw
      - PENDING 변경요청 존재하면 `CHANGE_REQUEST_ALREADY_PENDING(409)` throw
      - `Object.keys(changes).length === 0`이면 `CHANGES_REQUIRED(400)` throw
      - changes에 specs가 포함된 경우 `validateSpecsQuantity` 호출 (quantity 변경 시 변경 후 값 기준)
      - `prisma.changeRequest.create` → 변경요청 반환
    - `findChangeRequestsByOrderId(orderId)`: 목록 반환 (createdAt ASC 정렬)
    - `approveChangeRequest(orderId, requestId, dto, userId)`: 단일 트랜잭션
      - 변경요청 조회 — 없으면 `CHANGE_REQUEST_NOT_FOUND(404)`
      - status가 PENDING이 아니면 `CHANGE_REQUEST_NOT_PENDING(400)` throw
      - `prisma.$transaction`:
        1. `changeRequest.update` → status APPROVED, reviewedBy=userId, reviewComment, reviewedAt=now()
        2. `purchaseOrder.update` → changes 필드 반영, currentVersion +1
        3. `purchaseOrderVersion.create` → 버전 스냅샷 insert (changeRequestId=requestId, changedBy=userId, reason=변경요청.reason)
        - **주**: 승인 시 발주서 status는 CONFIRMED 유지 → 상태 전이 없음 → `orderStatusLog` 미생성
      - 업데이트된 변경요청 반환
    - `rejectChangeRequest(orderId, requestId, dto, userId)`:
      - 변경요청 조회 — 없으면 `CHANGE_REQUEST_NOT_FOUND(404)`
      - status가 PENDING이 아니면 `CHANGE_REQUEST_NOT_PENDING(400)` throw
      - `changeRequest.update` → status REJECTED, reviewedBy, reviewComment, reviewedAt
      - 업데이트된 변경요청 반환
  - [x] `src/change-requests/change-requests.module.ts` 생성

- **완료 기준**: 승인 트랜잭션이 원자적으로 동작 (한 단계 실패 시 전체 롤백).
- **테스트**:
  - [x] `createChangeRequest` 정상 케이스 → 201
  - [x] `createChangeRequest` CONFIRMED 미만 발주서 → 400 ORDER_NOT_CONFIRMED
  - [x] `createChangeRequest` PENDING 중복 → 409 CHANGE_REQUEST_ALREADY_PENDING
  - [x] `createChangeRequest` `changes: {}` → 400 CHANGES_REQUIRED
  - [x] `createChangeRequest` specs 포함 시 sizes 합계 불일치 → 400 INVALID_SPECS_QUANTITY
  - [x] `approveChangeRequest` 정상 케이스 — 트랜잭션 3단계 호출, currentVersion +1, 스냅샷 1행, `OrderStatusLog` 0행 검증
  - [x] `approveChangeRequest` PENDING 아닌 변경요청 → 400 CHANGE_REQUEST_NOT_PENDING
  - [x] `rejectChangeRequest` 정상 케이스 — 발주서 불변 확인
  - [x] `rejectChangeRequest` PENDING 아닌 변경요청 → 400 CHANGE_REQUEST_NOT_PENDING
  ```bash
  yarn test --testPathPattern=change-requests.service
  ```

### 4-2. change-requests — Controller

- **목적**: 변경요청 API 4종을 Controller로 노출한다.
- **작업 내용**:
  - [x] `src/change-requests/change-requests.controller.ts` 생성
    - `POST /orders/:id/change-requests` — `@Roles(Role.BUYER)`, `@HttpCode(201)`
    - `GET /orders/:id/change-requests` — 전체 역할 허용
    - `PATCH /orders/:id/change-requests/:requestId/approve` — `@Roles(Role.SOURCING)`
    - `PATCH /orders/:id/change-requests/:requestId/reject` — `@Roles(Role.SOURCING)`
    - 모든 응답 `{ success: true, data: ... }` 래핑
    - `@ApiTags('change-requests')` Swagger 어노테이션
  - [x] `AppModule`에 `ChangeRequestsModule` import

- **완료 기준**: Swagger UI에서 4개 엔드포인트 확인, BUYER가 approve 요청 시 403 반환.
- **테스트**:
  - [x] `POST /orders/:id/change-requests` BUYER 정상 → 201
  - [ ] `PATCH .../approve` BUYER 역할 → 403 (E2E Phase 7에서 검증)
  - [x] `PATCH .../approve` SOURCING 정상 → 200, 응답 status APPROVED
  - [x] `PATCH .../reject` SOURCING 정상 → 200, 응답 status REJECTED
  ```bash
  yarn test --testPathPattern=change-requests.controller
  ```

---

## Phase 5. history 모듈

### 5-1. history — Service

- **목적**: 이력 조회 4종(이력 목록 / 특정 버전 / 특정 시점 / 버전 비교) + 상태 변경 이력 조회 비즈니스 로직을 구현한다.
- **브랜치**: `feature/history`
- **작업 내용**:
  - [x] `src/history/history.service.ts` 생성
    - `getHistory(orderId)`:
      - 발주서 존재 여부 확인 (ORDER_NOT_FOUND 위임)
      - `purchaseOrderVersion.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })`
      - 버전 목록 반환
    - `getVersionSnapshot(orderId, version)`:
      - `purchaseOrderVersion.findUnique({ where: { orderId_version: { orderId, version } } })`
      - 없으면 `VERSION_NOT_FOUND(404)` throw
    - `getSnapshotAtTimestamp(orderId, timestamp)`:
      - timestamp 파싱 실패 시 `INVALID_TIMESTAMP(400)` throw
      - `purchaseOrderVersion.findFirst({ where: { orderId, createdAt: { lte: parsedTimestamp } }, orderBy: { createdAt: 'desc' } })`
      - 결과 없으면 `VERSION_NOT_FOUND(404)` throw
    - `compareVersions(orderId, from, to)`:
      - `getVersionSnapshot` 두 번 호출 (VERSION_NOT_FOUND 위임)
      - 비교 대상 필드: `productName`, `quantity`, `unitPrice`, `specs`, `deliveryDate`
      - 값이 다른 필드만 `{ field, before, after }[]` 반환
      - 동일 버전 비교 시 `diff: []` 반환
    - `getStatusHistory(orderId)`:
      - 발주서 존재 여부 확인 (ORDER_NOT_FOUND 위임)
      - `orderStatusLog.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })`
      - 결과 없음(이력 0건)은 빈 배열 반환

- **완료 기준**: 5종 조회가 모두 정확한 데이터를 반환하고, 없는 버전은 404를 반환함.
- **테스트**:
  - [x] `getHistory` 정상 케이스 — 버전 2건 createdAt ASC 정렬
  - [x] `getVersionSnapshot` version=2 → 정확한 스냅샷 반환
  - [x] `getVersionSnapshot` 존재하지 않는 버전 → 404 VERSION_NOT_FOUND
  - [x] `getSnapshotAtTimestamp` 특정 시점 이전 최신 버전 반환
  - [x] `getSnapshotAtTimestamp` 해당 시점 이전 버전 없음 → 404
  - [x] `getSnapshotAtTimestamp` 잘못된 timestamp 형식 → 400 INVALID_TIMESTAMP
  - [x] `compareVersions` v1 vs v3 → diff에 변경된 필드만 포함
  - [x] `compareVersions` v1 vs v1 → `diff: []`
  - [x] `compareVersions` 없는 버전 포함 → 404 VERSION_NOT_FOUND
  - [x] `getStatusHistory` 정상 케이스 — createdAt ASC 정렬, `OrderStatusLog` 행 수 일치
  - [x] `getStatusHistory` 이력 0건 → 빈 배열 반환
  - [x] `getStatusHistory` 존재하지 않는 발주서 → 404 ORDER_NOT_FOUND
  ```bash
  yarn test --testPathPattern=history.service
  ```

### 5-2. history — Controller

- **목적**: 이력 조회 API 5종을 Controller로 노출한다.
- **작업 내용**:
  - [ ] `src/history/history.controller.ts` 생성
    - `GET /orders/:id/history` — 전체 역할 허용
    - `GET /orders/:id/versions/:version` — 전체 역할 허용, `:version`은 `ParseIntPipe`로 정수 변환
    - `GET /orders/:id/at` — 전체 역할 허용, `timestamp` query param 필수
    - `GET /orders/:id/compare` — 전체 역할 허용, `from`, `to` query param 필수 (`ParseIntPipe`)
    - `GET /orders/:id/status-history` — 전체 역할 허용, createdAt ASC 정렬, 이력 0건이면 빈 배열 반환
    - 모든 응답 `{ success: true, data: ... }` 래핑
    - `@ApiTags('history')` Swagger 어노테이션
  - [ ] `src/history/history.module.ts` 생성
  - [ ] `AppModule`에 `HistoryModule` import

- **완료 기준**: Swagger UI에서 5개 엔드포인트 확인.
- **테스트**:
  - [ ] `GET /orders/:id/history` → 200, 버전 배열 반환
  - [ ] `GET /orders/:id/versions/:version` 존재하는 버전 → 200
  - [ ] `GET /orders/:id/versions/:version` 없는 버전 → 404
  - [ ] `GET /orders/:id/at?timestamp=...` 유효한 시점 → 200
  - [ ] `GET /orders/:id/at?timestamp=invalid` → 400 INVALID_TIMESTAMP
  - [ ] `GET /orders/:id/compare?from=1&to=3` → 200, diff 배열
  - [ ] `GET /orders/:id/status-history` → 200, 상태 로그 배열 반환 (createdAt ASC)
  - [ ] `GET /orders/:id/status-history` 이력 0건 → 200, 빈 배열
  - [ ] `GET /orders/:id/status-history` 없는 발주서 → 404 ORDER_NOT_FOUND
  ```bash
  yarn test --testPathPattern=history.controller
  ```

---

## Phase 6. DESIGN.md 작성

### 6-1. DESIGN.md 작성

- **목적**: 이력 관리 전략(스냅샷-only) 선택 근거, 대안 비교, 구현 상세를 문서화한다. 과제 제출 요건 항목.
- **브랜치**: `feature/design-doc`
- **작업 내용**:
  - [ ] `DESIGN.md` 작성 — 아래 섹션 포함
    - 이력 관리 전략 개요 (스냅샷-only 선택)
    - 고려한 대안 비교 (스냅샷+델타 / 델타-only 이벤트 소싱)
    - 선택 근거 (4종 조회 요건과 스냅샷의 자연스러운 대응)
    - 트랜잭션 전략 (확정 시 / 승인 시 단일 트랜잭션 범위 명시)
    - 인덱스 설계 (`@@unique([orderId, version])`, `@@index([orderId, createdAt])` 사용 이유)
    - 시점 조회 쿼리 (`WHERE orderId = ? AND createdAt <= ? ORDER BY createdAt DESC LIMIT 1`)
    - 버전 비교 런타임 diff 구현 방식
    - 확장 고려사항 (동시성 제어, 대용량 처리를 미포함으로 결정한 근거)

- **완료 기준**: `DESIGN.md`에 각 섹션이 명확히 서술되어 있고, 의사결정 근거가 포함되어 있음.

---

## Phase 7. 통합 테스트 및 최종 검증

### 7-1. E2E 통합 테스트

- **목적**: 전체 플로우(생성 → 확정 → 변경요청 → 승인 → 이력 조회 → 버전 비교)를 실제 DB와 연동하여 검증한다.
- **브랜치**: `feature/e2e-test`
- **작업 내용**:
  - [ ] `test/app.e2e-spec.ts` — 통합 시나리오 작성
    - 시나리오 1: 발주서 생성(`status: PENDING` 명시) → 확정(CONFIRMED, v1) → 변경요청 생성 → 승인(v2) → 이력 조회 2건 확인 → v1 vs v2 비교
    - 시나리오 1-1: 발주서 생성(`status` 생략) → 응답 status가 `DRAFT`인지 확인
    - 시나리오 2: 확정 전 변경요청 생성 → 400 ORDER_NOT_CONFIRMED
    - 시나리오 3: PENDING 변경요청 존재 시 신규 생성 → 409 CHANGE_REQUEST_ALREADY_PENDING
    - 시나리오 4: BUYER가 승인 요청 → 403 FORBIDDEN_ROLE
    - 시나리오 5: `changes: {}` 변경요청 생성 → 400 CHANGES_REQUIRED
    - 시나리오 6: specs sizes 합계 불일치 → 400 INVALID_SPECS_QUANTITY
    - 시나리오 6-1: `changes`에 `specs` 포함(정상 합계) 변경요청 생성 → 201, specs 중첩 검증 통과 확인
    - 시나리오 6-2: `changes`에 허용 외 필드 포함 → 400 (forbidNonWhitelisted)
    - 시나리오 7: 없는 버전 조회 → 404 VERSION_NOT_FOUND
    - 시나리오 8: 동일 버전 비교 → `diff: []`
    - 시나리오 9: 승인 트랜잭션 롤백 동작 확인 (mock으로 중간 실패 주입)
    - 시나리오 10: 확정 → 승인 후 `GET /orders/:id/status-history` → `OrderStatusLog` 행 수 및 fromStatus/toStatus 값 검증
    - 시나리오 10-1: 변경 이력 없는 발주서의 `GET /orders/:id/status-history` → 빈 배열 반환
  - [ ] 각 E2E 테스트는 독립적으로 실행될 수 있도록 테스트 전 DB 초기화 처리

- **완료 기준**: `yarn test:e2e` 전체 통과.
- **검증**:
  ```bash
  yarn test:e2e
  ```

---

## 최종 검증

- [ ] 전체 단위 테스트 통과
  ```bash
  yarn test
  ```
- [ ] E2E 테스트 통과
  ```bash
  yarn test:e2e
  ```
- [ ] 커버리지 확인
  ```bash
  yarn test:cov
  ```
- [ ] 프로덕션 빌드 성공
  ```bash
  yarn build
  ```
- [ ] 로컬 서버 기동 확인
  ```bash
  yarn start:dev
  ```
- [ ] Swagger UI 확인: http://localhost:3000/api
  - orders 태그: POST /orders, GET /orders/:id, PATCH /orders/:id/confirm (3개)
  - change-requests 태그: POST, GET, PATCH approve, PATCH reject (4개)
  - history 태그: GET history, GET versions/:version, GET at, GET compare, GET status-history (5개)
- [ ] Definition of Done 항목 전체 체크
  - [ ] 이력 조회 4종 API 모두 동작
  - [ ] 승인 트랜잭션 롤백 동작 확인
  - [ ] 비즈니스 규칙 검증 (권한, 상태, 중복) 동작
  - [ ] DESIGN.md 완성
  - [ ] 테스트 시나리오 전체 통과

---

## 리스크 및 주의사항

1. **`unitPrice` Decimal 직렬화**: Prisma의 `Decimal` 타입은 JSON 직렬화 시 문자열(`"15000.00"`)로 반환된다. PRD 응답 예시와 일치하나, 프론트엔드 연동 시 타입 주의.

2. **`deliveryDate` 시간대 처리**: `@db.Date` 타입은 날짜만 저장한다. Prisma가 반환 시 `DateTime` 객체로 처리하여 UTC 기준 자정(`2025-03-15T00:00:00.000Z`)으로 직렬화된다. API 응답에서 날짜 형식 통일 필요.

3. **`compareVersions` diff 대상 필드**: `specs`는 JSON이므로 단순 `===` 비교로 deep equality를 보장할 수 없다. `JSON.stringify` 기반 비교 또는 `fast-deep-equal` 라이브러리 사용을 권장.

4. **트랜잭션 격리 수준**: 동시성 제어는 PRD 미포함 범위이나, Prisma `$transaction` 사용 시 MySQL 기본 격리 수준(REPEATABLE READ)이 적용된다. 동시 승인 요청에 대한 중복 처리 가능성은 MVP 제외 항목임을 팀에 공유.

5. **E2E 테스트 DB 격리**: E2E 테스트 실행 시 실제 DB를 사용하므로 테스트 전후 데이터 초기화(`prisma.$executeRaw('TRUNCATE ...')` 또는 별도 테스트 DB)가 필요하다.
