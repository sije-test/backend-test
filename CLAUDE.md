# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

SIJE 발주서 변경 승인 프로세스 API — NestJS 11 + Prisma 7 (MariaDB 어댑터) 기반 백엔드 서버.

- 포트: 3000 (기본값)
- Swagger UI: `http://localhost:3000/api`
- DB: MySQL 8 (`sije_db`)

## 개발 환경 설정

```bash
# 의존성 설치
yarn install

# .env 설정 (.env.example 참고)
cp .env.example .env

# DB 실행 (Docker)
docker-compose up mysql -d

# Prisma 마이그레이션
yarn prisma migrate dev

# Prisma 클라이언트 생성 (schema 변경 후 필수)
yarn prisma generate
```

## 주요 명령어

```bash
yarn start:dev         # 개발 서버 (watch 모드)
yarn build             # 프로덕션 빌드
yarn start:prod        # 빌드된 앱 실행

yarn test              # 단위 테스트
yarn test:e2e          # E2E 테스트
yarn test:cov          # 커버리지 포함

yarn lint              # ESLint (자동 수정 포함)
yarn format            # Prettier 포맷

# 특정 테스트 파일만 실행
yarn test --testPathPattern=app.controller
```

## 아키텍처

NestJS 표준 모듈 구조를 따른다.

- **`src/app.module.ts`** — 루트 모듈. `ConfigModule` (글로벌), `PrismaModule` 임포트
- **`src/main.ts`** — 앱 부트스트랩: `ValidationPipe` (whitelist/transform/forbidNonWhitelisted), Swagger 설정
- **`src/prisma/`** — `PrismaService`는 `@prisma/adapter-mariadb`를 사용해 MariaDB에 연결. 환경변수로 DB 접속 정보를 주입받음
- **`src/generated/prisma/`** — `yarn prisma generate`로 생성되는 파일. 직접 수정 금지

## Prisma 관련 주의사항

- Prisma 클라이언트는 `src/generated/prisma/client`에 생성됨 (표준 위치 아님)
- `prisma.config.ts`가 마이그레이션/스키마 경로를 관리하며, `DATABASE_URL` 환경변수로 DB URL을 주입
- `prisma/schema.prisma`의 `datasource`에는 `url`이 없음 — `prisma.config.ts`에서 런타임 주입됨
- schema 변경 시 반드시 `yarn prisma migrate dev` → `yarn prisma generate` 순서로 실행

## 환경변수

`.env.example` 참고. 필수 변수:

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | Prisma 마이그레이션용 MySQL 연결 문자열 |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | 런타임 MariaDB 어댑터 접속 정보 |
| `PORT` | 앱 포트 (기본 3000) |
