/*
 * Copyright 2023 Kévin Gomez <contact@kevingomez.fr>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { MissingAnnotationEmptyState } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import {
  GRAFANA_ANNOTATION_OVERVIEW_DASHBOARD,
  isOverviewDashboardAvailable,
  overviewDashboardFromEntity,
} from '../grafanaData';

export const DashboardViewer = ({ embedUrl }: { embedUrl: string }) => {
  return (
    <iframe
      title={embedUrl}
      src={embedUrl}
      width="100%"
      height="100%"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
};

export const EntityDashboardViewer = () => {
  const { entity } = useEntity();
  const config = useApi(configApiRef);

  if (!isOverviewDashboardAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={GRAFANA_ANNOTATION_OVERVIEW_DASHBOARD} />;
  }

  const grafanaDomain = config.getString('grafana.domain');
  const dashboardPath = overviewDashboardFromEntity(entity);
  const embedUrl = `${grafanaDomain}/d/${dashboardPath}&theme=dark&kiosk`;

  return <DashboardViewer embedUrl={embedUrl} />
};
