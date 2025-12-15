import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import {
  grafanaApiRef,
  UnifiedAlertingGrafanaApiClient,
} from '@k-phoen/backstage-plugin-grafana';

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  ScmAuth.createDefaultApiFactory(),
  createApiFactory({
    api: grafanaApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      identityApi: identityApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, identityApi, configApi }) =>
      new UnifiedAlertingGrafanaApiClient({
        discoveryApi,
        identityApi,
        domain: configApi.getString('grafana.domain'),
        proxyPath: configApi.getOptionalString('grafana.proxyPath'),
      }),
  }),
];
