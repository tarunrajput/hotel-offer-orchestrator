import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { envDetector, serviceInstanceIdDetector } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

export function startTelemetry(serviceName: string) {
  const disabled = process.env.OTEL_SDK_DISABLED?.toLowerCase();
  const hasEndpoint = [
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  ].some((name) => Boolean(process.env[name]));

  if (disabled === 'true' || (!hasEndpoint && disabled !== 'false')) {
    return { enabled: false, shutdown: async () => {} };
  }

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || serviceName,
    resourceDetectors: [serviceInstanceIdDetector, envDetector],
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [new PinoInstrumentation(), new RuntimeNodeInstrumentation()],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
