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

import React, { useState } from 'react';
import { Progress, Link, MissingAnnotationEmptyState } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { grafanaApiRef } from '../../api';
import { useAsync } from 'react-use';
import { Alert } from '@material-ui/lab';
import { SLO } from '../../types';
import {
  GRAFANA_ANNOTATION_SLO_LABEL_SELECTOR,
  isSLOSelectorAvailable,
  sloSelectorFromEntity,
} from '../grafanaData';
import {
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  makeStyles,
  Tooltip,
  Typography,
} from '@material-ui/core';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import WarningIcon from '@material-ui/icons/Warning';
import ErrorIcon from '@material-ui/icons/Error';
import { Line } from 'react-chartjs-2';
import { format } from 'date-fns';
import { TimeSeries, TimeRange } from '../../types';
import { ChartOptions } from 'chart.js';

type TimeRangeOption = '1h' | '6h' | '24h' | '7d';

const SLIChart = ({ data, sloTarget, timeRangeOption, timeRange }: {
  data: TimeSeries[];
  sloTarget: number;
  timeRangeOption: TimeRangeOption;
  timeRange: TimeRange;
}) => {
  const now = Date.now();
  const parseTimeToMs = (timeStr: string): number => {
    if (timeStr === 'now') return now;
    const match = timeStr.match(/^now-(\d+)([smhd])$/);
    if (!match) return now;
    const value = parseInt(match[1], 10);
    const unitChar = match[2];
    const msMultipliers: Record<string, number> = {
      s: 1000, m: 60000, h: 3600000, d: 86400000,
    };
    return now - (value * msMultipliers[unitChar]);
  };

  const xAxisMin = parseTimeToMs(timeRange.from);
  const xAxisMax = parseTimeToMs(timeRange.to);

  const dataPoints = data[0]?.datapoints.map(dp => ({
    x: dp.timestamp,
    y: dp.value,
  })) || [];

  const chartData = {
    datasets: [
      {
        label: 'SLI',
        data: dataPoints,
        borderColor: (context: any) => {
          const value = context.raw?.y;
          if (value === undefined) return '#73BF69';
          return value >= sloTarget ? '#73BF69' : '#F2495C';
        },
        segment: {
          borderColor: (context: any) => {
            const current = context.p1.parsed.y;
            const previous = context.p0.parsed.y;
            if (current === undefined || previous === undefined) return '#73BF69';
            return (current >= sloTarget && previous >= sloTarget) ? '#73BF69' : '#F2495C';
          },
        },
        backgroundColor: '#73BF69',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        hitRadius: 10,
        tension: 0.1,
        spanGaps: true,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${(context.parsed.y * 100).toFixed(2)}%`,
          title: (tooltipItems) => format(tooltipItems[0].parsed.x, 'MMM dd, HH:mm:ss'),
        },
      },
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeRangeOption === '7d' ? 'day' : timeRangeOption === '1h' ? 'minute' : 'hour',
          stepSize: timeRangeOption === '1h' ? 10 : undefined,
          displayFormats: {
            minute: 'HH:mm',
            hour: 'HH:mm',
            day: 'MMM dd',
          },
        },
        min: xAxisMin,
        max: xAxisMax,
        bounds: 'data',
        offset: false,
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: {
          font: { size: 12 },
          color: 'rgba(255, 255, 255, 0.7)',
          maxRotation: 0,
          autoSkipPadding: 20,
        },
      },
      y: {
        beginAtZero: false,
        grid: { color: 'rgba(255, 255, 255, 0.1)' },
        ticks: {
          font: { size: 12 },
          color: 'rgba(255, 255, 255, 0.7)',
          callback: (value) => `${(Number(value) * 100).toFixed(1)}%`,
        },
      },
    },
  };

  return (
    <Box>
      <Typography variant="subtitle2" color="textSecondary" style={{ marginBottom: 8 }}>
        SLI
      </Typography>
      {!data || data.length === 0 || data[0]?.datapoints.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          No data available
        </Typography>
      ) : (
        <Box height={150}>
          <Line data={chartData} options={options} />
        </Box>
      )}
    </Box>
  );
};

const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const getSLOUrl = (domain: string, slo: SLO, timeRange?: string): string => {
  const slug = slugify(slo.name);
  const baseUrl = `${domain}/d/grafana_slo_app-${slo.uuid}/${slug}-${slo.uuid}`;

  if (timeRange) {
    return `${baseUrl}?from=${timeRange}&to=now&timezone=browser`;
  }

  return baseUrl;
};

type TimeRangeOption = '1h' | '6h' | '24h' | '7d';

const TIME_RANGE_OPTIONS: Record<TimeRangeOption, { label: string; from: string }> = {
  '1h': { label: '1 Hour', from: 'now-1h' },
  '6h': { label: '6 Hours', from: 'now-6h' },
  '24h': { label: '24 Hours', from: 'now-24h' },
  '7d': { label: '7 Days', from: 'now-7d' },
};

const useStyles = makeStyles((theme) => ({
  card: {
    height: '100%',
    minHeight: '400px',
  },
  sloItem: {
    marginBottom: theme.spacing(2),
    padding: theme.spacing(3),
    backgroundColor: theme.palette.type === 'dark' ? 'rgba(36, 41, 46, 0.8)' : theme.palette.background.paper,
    border: `1px solid ${theme.palette.type === 'dark' ? 'rgba(110, 118, 129, 0.4)' : theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    minHeight: '200px',
    transition: 'all 0.2s ease-in-out',
    '&:hover': {
      backgroundColor: theme.palette.type === 'dark' ? 'rgba(46, 51, 56, 0.9)' : theme.palette.background.default,
      borderColor: theme.palette.primary.main,
    },
  },
  sloHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(2),
  },
  sloName: {
    fontWeight: 600,
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
  },
  sliMetricsContainer: {
    display: 'flex',
    gap: theme.spacing(3),
    marginBottom: theme.spacing(2),
  },
  sliMetricBox: {
    flex: 1,
  },
  sliLabel: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(0.5),
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  sliValue: {
    fontSize: '2rem',
    fontWeight: 700,
    lineHeight: 1.2,
  },
  sloValue: {
    fontSize: '1.5rem',
    fontWeight: 600,
    lineHeight: 1.2,
  },
  statusIcon: {
    fontSize: '1.2rem',
  },
  healthyIcon: {
    color: '#73BF69',
  },
  warningIcon: {
    color: '#FF9800',
  },
  errorIcon: {
    color: '#F2495C',
  },
  objectiveRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1.5),
  },
  progressBar: {
    height: 10,
    borderRadius: 5,
    marginBottom: theme.spacing(2),
    backgroundColor: theme.palette.type === 'dark' ? 'rgba(110, 118, 129, 0.3)' : theme.palette.grey[200],
  },
  errorBudgetText: {
    fontSize: '0.875rem',
    fontWeight: 500,
    color: theme.palette.text.secondary,
  },
  errorBudgetValue: {
    fontSize: '1.1rem',
    fontWeight: 600,
  },
  description: {
    fontSize: '0.875rem',
    color: theme.palette.text.secondary,
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(2),
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    cursor: 'help',
  },
  emptyState: {
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  labels: {
    marginTop: theme.spacing(2),
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(0.5),
  },
  timeRangeSelector: {
    marginBottom: theme.spacing(2),
  },
  metadataRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing(1),
    paddingTop: theme.spacing(1.5),
    borderTop: `1px solid ${theme.palette.type === 'dark' ? 'rgba(110, 118, 129, 0.2)' : theme.palette.divider}`,
  },
}));

interface SLOStatusIndicatorProps {
  slo: SLO;
  classes: any;
  opts: SLOCardOpts;
  timeRange: string;
}

const SLOStatusIndicator = React.memo(({ slo, classes, opts, timeRange }: SLOStatusIndicatorProps) => {
  const healthyThreshold = opts.healthyThreshold ?? 50;
  const warningThreshold = opts.warningThreshold ?? 0;
  const maxLabels = opts.maxLabels ?? 3;
  const hasStatus = slo.status && typeof slo.status.current === 'number' && typeof slo.status.remaining_error_budget === 'number';

  if (!hasStatus) {
    return (
      <Box className={classes.sloItem}>
        <Box className={classes.sloHeader}>
          <Box>
            <Typography variant="subtitle1" className={classes.sloName}>
              <WarningIcon className={`${classes.statusIcon} ${classes.warningIcon}`} />
              {slo.name}
            </Typography>
          </Box>
          <Chip
            label="NO DATA"
            size="small"
            style={{ backgroundColor: '#757575', color: 'white' }}
          />
        </Box>
        {slo.description && (
          <Tooltip title={slo.description} placement="top">
            <Typography className={classes.description}>
              {slo.description}
            </Typography>
          </Tooltip>
        )}
        <Typography variant="body2" color="textSecondary">
          Status data unavailable for this SLO
        </Typography>
      </Box>
    );
  }

  const current = slo.status!.current;
  const remainingBudget = slo.status!.remaining_error_budget;

  const objective = slo.objectives[0];
  const targetPercentage = objective ? objective.value * 100 : 0;
  const currentPercentage = current * 100;
  const isMeetingObjective = current >= objective.value;

  let status: 'healthy' | 'warning' | 'breached';
  let statusIcon: React.ReactNode;
  let statusChipStyle: React.CSSProperties;
  let sliValueColor: string;

  if (isMeetingObjective) {
    status = 'healthy';
    statusIcon = <CheckCircleIcon className={`${classes.statusIcon} ${classes.healthyIcon}`} />;
    statusChipStyle = { backgroundColor: '#73BF69', color: 'white' };
    sliValueColor = '#73BF69';
  } else if (remainingBudget > warningThreshold) {
    status = 'warning';
    statusIcon = <WarningIcon className={`${classes.statusIcon} ${classes.warningIcon}`} />;
    statusChipStyle = { backgroundColor: '#FF9800', color: 'white' };
    sliValueColor = '#FF9800';
  } else {
    status = 'breached';
    statusIcon = <ErrorIcon className={`${classes.statusIcon} ${classes.errorIcon}`} />;
    statusChipStyle = { backgroundColor: '#F2495C', color: 'white' };
    sliValueColor = '#F2495C';
  }

  const getErrorBudgetColor = () => {
    if (remainingBudget > healthyThreshold) return '#73BF69';
    if (remainingBudget > warningThreshold) return '#FF9800';
    return '#F2495C';
  };

  return (
    <Box className={classes.sloItem}>
      <Box className={classes.sloHeader}>
        <Box>
          <Typography variant="subtitle1" className={classes.sloName}>
            {statusIcon}
            {slo.name}
          </Typography>
          {slo.description && (
            <Tooltip title={slo.description} placement="top">
              <Typography className={classes.description}>
                {slo.description}
              </Typography>
            </Tooltip>
          )}
        </Box>
        <Chip
          label={status.toUpperCase()}
          size="small"
          style={statusChipStyle}
        />
      </Box>

      {slo.sliTimeSeries && slo.sliTimeSeries.length > 0 && (
        <Box style={{ marginBottom: 24 }}>
          <SLIChart
            data={slo.sliTimeSeries}
            sloTarget={objective.value}
            timeRangeOption={timeRange === 'now-1h' ? '1h' : timeRange === 'now-6h' ? '6h' : timeRange === 'now-24h' ? '24h' : '7d'}
            timeRange={{ from: timeRange, to: 'now' }}
          />
        </Box>
      )}

      <Box className={classes.sliMetricsContainer}>
        <Box className={classes.sliMetricBox}>
          <Typography className={classes.sliLabel}>SLI (Selected Window)</Typography>
          <Typography className={classes.sliValue} style={{ color: sliValueColor }}>
            {currentPercentage.toFixed(2)}%
          </Typography>
        </Box>
        <Box className={classes.sliMetricBox}>
          <Typography className={classes.sliLabel}>SLO</Typography>
          <Typography className={classes.sloValue} style={{ color: '#5794F2' }}>
            {targetPercentage.toFixed(2)}%
          </Typography>
        </Box>
        <Box className={classes.sliMetricBox}>
          <Typography className={classes.sliLabel}>Error Budget Remaining</Typography>
          <Typography className={classes.errorBudgetValue} style={{ color: getErrorBudgetColor() }}>
            {remainingBudget.toFixed(2)}%
          </Typography>
        </Box>
      </Box>

      <Box className={classes.sliMetricsContainer} style={{ marginTop: 16 }}>
        {slo.status.failure_events !== undefined && (
          <Box className={classes.sliMetricBox}>
            <Typography className={classes.sliLabel}>Failure Events</Typography>
            <Typography className={classes.errorBudgetValue} style={{ color: '#F2495C' }}>
              {Math.round(slo.status.failure_events).toLocaleString()}
            </Typography>
          </Box>
        )}
        {slo.status.total_events !== undefined && (
          <Box className={classes.sliMetricBox}>
            <Typography className={classes.sliLabel}>Total Events</Typography>
            <Typography className={classes.errorBudgetValue}>
              {Math.round(slo.status.total_events).toLocaleString()}
            </Typography>
          </Box>
        )}
      </Box>

      <Box className={classes.metadataRow}>
        {objective && (
          <Typography variant="caption" className={classes.errorBudgetText}>
            Window: {objective.window}
          </Typography>
        )}
        {slo.labels && Array.isArray(slo.labels) && slo.labels.length > 0 && (
          <Box className={classes.labels} style={{ marginTop: 0 }}>
            {slo.labels.slice(0, maxLabels).map((label) => (
              <Chip
                key={label.key}
                label={`${label.key}: ${label.value}`}
                size="small"
                variant="outlined"
                style={{ fontSize: '0.7rem', height: '20px' }}
              />
            ))}
            {slo.labels.length > maxLabels && (
              <Chip
                label={`+${slo.labels.length - maxLabels}`}
                size="small"
                variant="outlined"
                style={{ fontSize: '0.7rem', height: '20px' }}
              />
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.slo.uuid === nextProps.slo.uuid &&
    prevProps.slo.status?.current === nextProps.slo.status?.current &&
    prevProps.slo.status?.remaining_error_budget === nextProps.slo.status?.remaining_error_budget &&
    prevProps.timeRange === nextProps.timeRange
  );
});

const SLOList = ({ entity, opts, timeRange }: { entity: Entity; opts: SLOCardOpts; timeRange: string }) => {
  const classes = useStyles();
  const grafanaApi = useApi(grafanaApiRef);
  const configApi = useApi(configApiRef);
  const domain = configApi.getString('grafana.domain');
  const labelSelector = sloSelectorFromEntity(entity);

  const { value, loading, error } = useAsync(
    async () => await grafanaApi.getSLOs(labelSelector, timeRange),
    [labelSelector, timeRange]
  );

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  const slos = value || [];

  if (slos.length === 0) {
    return (
      <Box className={classes.emptyState}>
        <Typography variant="body2">
          No SLOs found. Make sure you have SLOs configured in Grafana Cloud with matching labels.
        </Typography>
      </Box>
    );
  }

  const groupByStatus = opts.groupByStatus ?? false;

  if (groupByStatus && slos.length > 0) {
    const grouped = slos.reduce((acc, slo) => {
      const healthyThreshold = opts.healthyThreshold ?? 50;
      const warningThreshold = opts.warningThreshold ?? 0;
      const remainingBudget = slo.status?.remaining_error_budget ?? 100;

      let status: 'breached' | 'warning' | 'healthy';
      if (remainingBudget > healthyThreshold) {
        status = 'healthy';
      } else if (remainingBudget > warningThreshold) {
        status = 'warning';
      } else {
        status = 'breached';
      }

      if (!acc[status]) {
        acc[status] = [];
      }
      acc[status].push(slo);
      return acc;
    }, {} as Record<'breached' | 'warning' | 'healthy', SLO[]>);

    return (
      <Box>
        {grouped.breached && grouped.breached.length > 0 && (
          <Box mb={2}>
            <Typography variant="subtitle2" color="error" gutterBottom>
              Breached ({grouped.breached.length})
            </Typography>
            {grouped.breached.map((slo) => (
              <Link
                key={slo.uuid}
                to={getSLOUrl(domain, slo, timeRange)}
                target="_blank"
                rel="noopener"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <SLOStatusIndicator slo={slo} classes={classes} opts={opts} timeRange={timeRange} />
              </Link>
            ))}
          </Box>
        )}
        {grouped.warning && grouped.warning.length > 0 && (
          <Box mb={2}>
            <Typography variant="subtitle2" style={{ color: '#ff9800' }} gutterBottom>
              Warning ({grouped.warning.length})
            </Typography>
            {grouped.warning.map((slo) => (
              <Link
                key={slo.uuid}
                to={getSLOUrl(domain, slo, timeRange)}
                target="_blank"
                rel="noopener"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <SLOStatusIndicator slo={slo} classes={classes} opts={opts} timeRange={timeRange} />
              </Link>
            ))}
          </Box>
        )}
        {grouped.healthy && grouped.healthy.length > 0 && (
          <Box mb={2}>
            <Typography variant="subtitle2" style={{ color: '#4caf50' }} gutterBottom>
              Healthy ({grouped.healthy.length})
            </Typography>
            {grouped.healthy.map((slo) => (
              <Link
                key={slo.uuid}
                to={getSLOUrl(domain, slo, timeRange)}
                target="_blank"
                rel="noopener"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <SLOStatusIndicator slo={slo} classes={classes} opts={opts} timeRange={timeRange} />
              </Link>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box>
      {slos.map((slo) => (
        <Link
          key={slo.uuid}
          to={getSLOUrl(domain, slo, timeRange)}
          target="_blank"
          rel="noopener"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <SLOStatusIndicator slo={slo} classes={classes} opts={opts} timeRange={timeRange} />
        </Link>
      ))}
    </Box>
  );
};

export type SLOCardOpts = {
  title?: string;
  healthyThreshold?: number;
  warningThreshold?: number;
  maxLabels?: number;
  groupByStatus?: boolean;
  timeRange?: { from: string; to: string };
};

export const SLOCard = (opts?: SLOCardOpts) => {
  const classes = useStyles();
  const { entity } = useEntity();
  const [internalTimeRange, setInternalTimeRange] = useState<TimeRangeOption>('6h');

  if (!isSLOSelectorAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={GRAFANA_ANNOTATION_SLO_LABEL_SELECTOR} />;
  }

  const useExternalTimeRange = opts?.timeRange !== undefined;
  const selectedTimeRange = useExternalTimeRange
    ? opts.timeRange!.from
    : TIME_RANGE_OPTIONS[internalTimeRange].from;

  return (
    <Card className={classes.card}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{opts?.title || 'SLOs'}</Typography>
          {!useExternalTimeRange && (
            <ButtonGroup size="small" className={classes.timeRangeSelector}>
              {(Object.keys(TIME_RANGE_OPTIONS) as TimeRangeOption[]).map((range) => (
                <Button
                  key={range}
                  variant={internalTimeRange === range ? 'contained' : 'outlined'}
                  onClick={() => setInternalTimeRange(range)}
                >
                  {TIME_RANGE_OPTIONS[range].label}
                </Button>
              ))}
            </ButtonGroup>
          )}
        </Box>
        <SLOList entity={entity} opts={opts || {}} timeRange={selectedTimeRange} />
      </CardContent>
    </Card>
  );
};
