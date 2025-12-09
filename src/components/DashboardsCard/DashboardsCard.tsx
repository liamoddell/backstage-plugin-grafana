/*
 * Copyright 2021 Kévin Gomez <contact@kevingomez.fr>
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
import { Progress, TableColumn, Table, MissingAnnotationEmptyState, Link } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { grafanaApiRef } from '../../api';
import { useAsync } from 'react-use';
import { Alert } from '@material-ui/lab';
import { Tooltip } from '@material-ui/core';
import { Dashboard, TimeRange } from '../../types';
import {
  dashboardSelectorFromEntity,
  GRAFANA_ANNOTATION_DASHBOARD_SELECTOR,
  GRAFANA_ANNOTATION_OVERVIEW_DASHBOARD,
  isDashboardSelectorAvailable,
  isOverviewDashboardAvailable,
  overviewDashboardFromEntity
} from '../grafanaData';

// Helper function to parse Grafana time range format (e.g., "now-1h", "now-7d")
const parseTimeRange = (timeStr: string): number => {
  if (timeStr === 'now') return 0;

  const match = timeStr.match(/^now-(\d+)([smhdwMy])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    's': 1000,           // seconds
    'm': 60 * 1000,      // minutes
    'h': 60 * 60 * 1000, // hours
    'd': 24 * 60 * 60 * 1000, // days
    'w': 7 * 24 * 60 * 60 * 1000, // weeks
    'M': 30 * 24 * 60 * 60 * 1000, // months (approx)
    'y': 365 * 24 * 60 * 60 * 1000, // years (approx)
  };

  return -(value * (multipliers[unit] || 0));
};

export const DashboardsTable = ({entity, dashboards, opts}: {entity: Entity, dashboards: Dashboard[], opts: DashboardCardOpts}) => {
  const columns: TableColumn<Dashboard>[] = [
    {
      title: 'Title',
      field: 'title',
      render: (row: Dashboard) => <Link to={row.url} target="_blank" rel="noopener">{row.title}</Link>,
    },
    {
      title: 'Folder',
      field: 'folderTitle',
      render: (row: Dashboard) => <Link to={row.folderUrl} target="_blank" rel="noopener">{row.folderTitle}</Link>,
    },
  ];

  const titleElm = (
    <Tooltip title={`Note: only dashboard with the "${dashboardSelectorFromEntity(entity)}" selector are displayed.`}>
      <span>{opts.title || 'Dashboards'}</span>
    </Tooltip>
  );

  return (
    <Table
      title={titleElm}
      options={{
        paging: opts.paged ?? false,
        pageSize: opts.pageSize ?? 5,
        search: opts.searchable ?? false,
        emptyRowsWhenPaging: false,
        sorting: opts.sortable ?? false,
        draggable: false,
        padding: 'dense',
      }}
      data={dashboards}
      columns={columns}
    />
  );
};

const OverviewDashboard = ({entity, opts}: {entity: Entity, opts: DashboardCardOpts}) => {
  const config = useApi(configApiRef);
  const grafanaDomain = config.getString('grafana.domain');
  const dashboardPath = overviewDashboardFromEntity(entity);

  // Add time range parameters if provided
  let dashboardUrl = `${grafanaDomain}/d/${dashboardPath}`;
  if (opts.timeRange) {
    const fromMs = Date.now() + parseTimeRange(opts.timeRange.from);
    const toMs = Date.now() + parseTimeRange(opts.timeRange.to || 'now');
    dashboardUrl += `&from=${fromMs}&to=${toMs}`;
  }

  const dashboard: Dashboard = {
    uid: dashboardPath.split('?')[0],
    title: opts.title || 'Overview Dashboard',
    url: dashboardUrl,
    folderTitle: '',
    folderUrl: '',
  };

  const columns: TableColumn<Dashboard>[] = [
    {
      title: 'Title',
      field: 'title',
      render: (row: Dashboard) => <Link to={row.url} target="_blank" rel="noopener">{row.title}</Link>,
    },
  ];

  return (
    <Table
      title={opts.title || 'Dashboard'}
      options={{
        paging: false,
        search: false,
        emptyRowsWhenPaging: false,
        sorting: false,
        draggable: false,
        padding: 'dense',
      }}
      data={[dashboard]}
      columns={columns}
    />
  );
};

const Dashboards = ({entity, opts}: {entity: Entity, opts: DashboardCardOpts}) => {
  const grafanaApi = useApi(grafanaApiRef);
  const { value, loading, error } = useAsync(async () => await grafanaApi.listDashboards(dashboardSelectorFromEntity(entity)));

  if (loading) {
    return <Progress />;
  } else if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  return (
    <DashboardsTable entity={entity} dashboards={value || []} opts={opts} />
  );
};

export type DashboardCardOpts = {
  paged?: boolean;
  searchable?: boolean;
  pageSize?: number;
  sortable?: boolean;
  title?: string;
  timeRange?: TimeRange;
};

export const DashboardsCard = (opts?: DashboardCardOpts) => {
  const { entity } = useEntity();

  // Check for overview dashboard annotation first, then fall back to dashboard selector
  if (isOverviewDashboardAvailable(entity)) {
    return <OverviewDashboard entity={entity} opts={opts || {}} />;
  }

  if (isDashboardSelectorAvailable(entity)) {
    return <Dashboards entity={entity} opts={opts || {}} />;
  }

  // If neither annotation is present, show missing annotation message
  return (
    <MissingAnnotationEmptyState annotation={`${GRAFANA_ANNOTATION_OVERVIEW_DASHBOARD} or ${GRAFANA_ANNOTATION_DASHBOARD_SELECTOR}`} />
  );
};
