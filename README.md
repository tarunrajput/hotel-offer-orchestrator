# Hotel Offer Orchestrator

An Express API that uses Temporal to fetch two hotel suppliers in parallel, selects the cheapest offer per hotel, and stores each search in Redis for price filtering. Local setup includes mock suppliers.

## Project structure

The folders follow a NestJS-style feature layout while keeping Express and explicit dependency wiring:

```text
src/
  main.ts                    # API entry point; initializes telemetry first
  instrumentation.ts         # API telemetry initialization
  bootstrap.ts               # Connects dependencies and starts the API
  app.ts                     # Composes middleware and controllers
  modules/
    hotel-search/
      hotel-search.controller.ts
      hotel-search.service.ts
      dto/                   # HTTP query parsing and validation
      interfaces/            # Offer types and dependency contracts
      exceptions/            # Search failures
      repositories/          # Redis snapshot storage
      temporal/              # Workflow, Activities, and workflow client
      utils/                 # Offer selection rules
    suppliers/
      supplier-http.client.ts
      supplier.types.ts
      suppliers.factory.ts   # Configures supplier clients
    health/
      health.controller.ts
  common/                    # Shared HTTP, middleware, telemetry, Redis, Temporal
  config/                    # Environment configuration and validation
  worker/                    # Temporal Worker entry point and bootstrap
  mock-suppliers/            # Standalone fixture server
```

Controllers handle HTTP, the hotel-search service coordinates a search, and repositories and clients handle external systems. Feature modules are plain TypeScript folders; dependencies are wired in the application bootstraps. NestJS decorators and a dependency injection container are not required.

## Local setup

Requires Docker with the Compose plugin.

```sh
cp .env.example .env
docker compose up --build --wait
curl -i 'http://127.0.0.1:3000/api/hotels?city=delhi'
```

This starts the API, Worker, mock suppliers, Redis, and Temporal. The default Delhi results are Holtin at 5,340 from Supplier B and Radison at 5,900 from Supplier A.

- API: [localhost:3000](http://127.0.0.1:3000/api/hotels?city=delhi)
- Temporal UI: [localhost:8233](http://127.0.0.1:8233)
- Configuration: edit `.env` to change ports, log level, snapshot lifetime, or mock supplier availability. Set `SUPPLIER_A_URL` and `SUPPLIER_B_URL` to override the mock endpoints.

```sh
docker compose logs -f api worker   # Inspect logs
docker compose down               # Stop the stack
```

The local Temporal server and Redis data are disposable; use the deployment steps below for a hosted environment.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/hotels?city=delhi` | Cheapest offer per hotel, ordered by price |
| `GET /api/hotels?city=delhi&minPrice=5800&maxPrice=6000` | Filter winning offers by inclusive price bounds |
| `GET /health` | Supplier health; returns 503 if either supplier probe fails |
| `GET /livez` | API process liveness |

`city` is required. Price bounds are optional non-negative whole numbers. Invalid queries return 400. If one supplier fails, the API returns available offers with `Hotel-Offer-Completeness: partial`; if both fail, it returns 502 or 504. Responses include a `Request-Id` for troubleshooting.

The API applies [Helmet](https://helmet.js.org/) security headers and uses [CORS middleware](https://expressjs.com/en/resources/middleware/cors/) for browser access. Set `CORS_ORIGINS` on the API (or in `.env` for Compose) to comma-separated frontend origins, for example `http://localhost:5173,https://app.example.com`. Use exact origins without paths or trailing slashes; wildcards are not accepted. An empty or unset value grants no cross-origin browser access. Requests from curl, Postman, and other servers continue to work.

Allowed origins can use `GET` and `HEAD`, with automatic `OPTIONS` preflight handling. Browser clients can read `Request-Id`, `Hotel-Offer-Completeness`, and `Hotel-Offer-Failed-Supplier`. Cross-origin credentials are not enabled.

## Deployment

1. Provision a production Temporal service and private Redis instance reachable by both the API and Worker. Create the Temporal namespace you will use.
2. Configure these environment variables on **both** services:

   | Variable | Value |
   | --- | --- |
   | `TEMPORAL_ADDRESS` | Temporal host and port |
   | `TEMPORAL_NAMESPACE` | Your namespace; default `default` |
   | `TEMPORAL_TASK_QUEUE` | Same queue on both services; default `hotel-offers` |
   | `REDIS_URL` | Redis connection URL (`redis://` or `rediss://`) |
   | `SUPPLIER_A_URL`, `SUPPLIER_B_URL` | Full supplier endpoint URLs |

   For Temporal Cloud API key authentication, set `TEMPORAL_TLS=true` and inject `TEMPORAL_API_KEY` from your secret store. The API listens on `PORT` (default `3000`); snapshots expire after `SNAPSHOT_TTL_SECONDS` (default `300`).

   Supplier endpoints must accept GET requests with a `city` query parameter and return arrays containing `hotelId`, `name`, `city`, `price`, and `commissionPct`. For other schemas or authentication, implement `SupplierClient` and register it in [suppliers.factory.ts](src/modules/suppliers/suppliers.factory.ts).

3. Build and publish the image, replacing the example registry and tag with your own:

   ```sh
   docker build -t registry.example.com/hotel-offer-orchestrator:1.0.0 .
   docker push registry.example.com/hotel-offer-orchestrator:1.0.0
   ```

4. Deploy the same image as two separate services with the environment above:

   | Service | Container command |
   | --- | --- |
   | API | `node dist/main.js` (image default) |
   | Worker | `node dist/worker/main.js` |

   Route HTTP traffic to the API's port and keep the Worker running to process searches. Use `/livez` for the API liveness probe.

5. Verify `/health` and run a search against `/api/hotels?city=delhi` using a city supported by your suppliers. Check API and Worker logs if the request fails.

## Development and checks

For local tooling, use Node.js and npm versions pinned in [`.nvmrc`](.nvmrc) and [`package.json`](package.json).

```sh
npm ci
npm run check
```

`check` runs type checking, lint, formatting checks, unit tests, and the build. Import the [Postman collection](postman/hotel-offer-orchestrator.postman_collection.json) and run **Default stack** against the running local stack for API checks.

HTTP middleware and query validation tests run without Redis or Temporal:

```sh
node --import tsx --test tests/integration/http-middleware.test.ts tests/integration/api-validation.test.ts
```

Integration tests require real Redis and Temporal:

```sh
TEMPORAL_UI_PORT=18233 docker compose -p hotel-offers-integration -f compose.yaml -f compose.integration.yaml up --wait redis temporal
REDIS_URL=redis://127.0.0.1:16379 TEMPORAL_ADDRESS=127.0.0.1:17233 npm run test:integration
docker compose -p hotel-offers-integration -f compose.yaml -f compose.integration.yaml down
```

Optional local telemetry: run `docker compose -f compose.yaml -f compose.observability.yaml up --build --wait`, then open [Jaeger](http://127.0.0.1:16686) or [Prometheus](http://127.0.0.1:9090). Use the same Compose files with `down` to stop it. For hosted telemetry, set `OTEL_EXPORTER_OTLP_ENDPOINT` on the application services.
