# Hotel Offer Orchestrator

An Express API that fetches hotel offers through Temporal, selects the cheapest offer per hotel, and stores search results in Redis for price filtering.

## Local setup

Requires Docker with the Compose plugin.

```sh
cp .env.example .env
docker compose up --build --wait
curl -i 'http://127.0.0.1:3000/api/hotels?city=delhi'
```

Starts the API, Worker, mock suppliers, Redis, and Temporal. The sample Delhi search returns Holtin at 5,340 and Radison at 5,900.

- API: [localhost:3000](http://localhost:3000/api/hotels?city=delhi)
- Temporal UI: [localhost:8233](http://localhost:8233)
- Edit `.env` to change ports, log level, snapshot lifetime, or mock supplier availability. Set `SUPPLIER_A_URL` and `SUPPLIER_B_URL` to use real suppliers.

```sh
docker compose logs -f api worker   # View logs
docker compose down               # Stop the stack
```

Local Redis and Temporal data are disposable. Use hosted services for deployment.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/hotels?city=delhi&minPrice=5800&maxPrice=6000` | Cheapest offers, sorted by price; price bounds are optional and inclusive |
| `GET /health` | Supplier health; returns 503 if either supplier is unavailable |
| `GET /livez` | API process liveness |

`city` is required. Price bounds must be non-negative whole numbers; invalid queries return 400. One supplier failure returns available offers with `Hotel-Offer-Completeness: partial`; both failing returns 502 or 504. Responses include a `Request-Id`.

## Deployment

1. Provision a production Temporal service and private Redis instance reachable by both the API and Worker. Create the Temporal namespace.
2. Configure the following on **both** services:

   | Variable | Value |
   | --- | --- |
   | `TEMPORAL_ADDRESS` | Temporal host and port |
   | `TEMPORAL_NAMESPACE` | Namespace; default `default` |
   | `TEMPORAL_TASK_QUEUE` | Same queue on both services; default `hotel-offers` |
   | `REDIS_URL` | Redis URL (`redis://` or `rediss://`) |
   | `SUPPLIER_A_URL`, `SUPPLIER_B_URL` | Full supplier endpoint URLs |

   For Temporal Cloud API key authentication, set `TEMPORAL_TLS=true` and inject `TEMPORAL_API_KEY` from your secret store. Optional settings: `SNAPSHOT_TTL_SECONDS` (default `300`) and `LOG_LEVEL` (default `info`).

   Suppliers must accept GET requests with a `city` query parameter and return arrays containing `hotelId`, `name`, `city`, `price`, and `commissionPct`. Register custom supplier clients in [suppliers.factory.ts](src/modules/suppliers/suppliers.factory.ts).

3. Build and publish the image using your registry and tag:

   ```sh
   docker build -t registry.example.com/hotel-offer-orchestrator:1.0.0 .
   docker push registry.example.com/hotel-offer-orchestrator:1.0.0
   ```

4. Deploy the same image as two services:

   | Service | Container command |
   | --- | --- |
   | API | `node dist/main.js` (image default) |
   | Worker | `node dist/worker/main.js` |

   Route HTTP traffic to the API's `PORT` (default `3000`) and keep the Worker running. Use `/livez` for API liveness. For browser access, set `CORS_ORIGINS` on the API to comma-separated exact origins, without paths or trailing slashes. Empty means no cross-origin browser access.

5. Verify `/health` and run `/api/hotels?city=delhi` with a city supported by your suppliers. Check API and Worker logs if the request fails.

## Development

Use the Node.js and npm versions pinned in [`.nvmrc`](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm run check
```

Runs type checking, lint, formatting checks, unit tests, and the build. The [Postman collection](postman/hotel-offer-orchestrator.postman_collection.json) includes API checks for the local stack.

For optional local tracing and metrics, start with `docker compose -f compose.yaml -f compose.observability.yaml up --build --wait`. Open [Jaeger](http://localhost:16686) or [Prometheus](http://localhost:9090); use the same Compose files with `down` to stop them. For hosted telemetry, set `OTEL_EXPORTER_OTLP_ENDPOINT` on the application services.
