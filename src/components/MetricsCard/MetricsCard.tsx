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

import React, { useState, useEffect } from 'react';
import { Progress, MissingAnnotationEmptyState } from '@backstage/core-components';
import { Entity } from '@backstage/catalog-model';
import { useEntity } from '@backstage/plugin-catalog-react';
import { useApi } from '@backstage/core-plugin-api';
import { grafanaApiRef } from '../../api';
import { useAsync } from 'react-use';
import { Alert } from '@material-ui/lab';
import { Box, Card, CardContent, Grid, Typography, ButtonGroup, Button, makeStyles, Select, MenuItem, FormControl } from '@material-ui/core';
import { TimeRange } from '../../types';
import { GRAFANA_ANNOTATION_METRICS_SELECTOR, isMetricsSelectorAvailable, metricsSelectorFromEntity } from '../grafanaData';
import { MetricChartJS } from './MetricsChartJS';

const useStyles = makeStyles((theme) => ({
  card: {
    height: '100%',
  },
  chartContainer: {
    marginTop: theme.spacing(2),
  },
  metricTitle: {
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
    fontWeight: 'bold',
  },
  timeRangeSelector: {
    marginBottom: theme.spacing(2),
  },
}));

type TimeRangeOption = '1h' | '6h' | '24h' | '7d';

const TIME_RANGE_OPTIONS: Record<TimeRangeOption, { label: string; from: string }> = {
  '1h': { label: '1 Hour', from: 'now-1h' },
  '6h': { label: '6 Hours', from: 'now-6h' },
  '24h': { label: '24 Hours', from: 'now-24h' },
  '7d': { label: '7 Days', from: 'now-7d' },
};

interface MetricsProps {
  entity: Entity;
  timeRange: TimeRange;
  timeRangeOption: TimeRangeOption;
  latencyType: LatencyType;
  setLatencyType: (type: LatencyType) => void;
}

interface MetricsInternalProps extends MetricsProps {
  refreshKey: number;
}

const Metrics = ({ entity, timeRange, timeRangeOption, latencyType, setLatencyType, refreshKey }: MetricsInternalProps) => {
  const classes = useStyles();
  const grafanaApi = useApi(grafanaApiRef);
  const metricsSelector = metricsSelectorFromEntity(entity);

  // Adjust rate interval and step based on time range
  const getRateInterval = (timeRange: TimeRange) => {
    if (timeRange.from === 'now-7d') return '1h';
    if (timeRange.from === 'now-24h') return '15m';
    if (timeRange.from === 'now-6h') return '5m';
    return '5m';
  };

  const getStepInterval = (timeRange: TimeRange) => {
    if (timeRange.from === 'now-7d') return '2h';
    if (timeRange.from === 'now-24h') return '5m';
    if (timeRange.from === 'now-6h') return '1m';
    return '30s'; // 1 hour
  };

  const rateInterval = getRateInterval(timeRange);
  const stepInterval = getStepInterval(timeRange);
  const requestRateQuery = `sum(rate(traces_spanmetrics_calls_total{${metricsSelector},span_kind="SPAN_KIND_SERVER"}[${rateInterval}]))`;
  const errorRateQuery = `sum(rate(traces_spanmetrics_calls_total{${metricsSelector},span_kind="SPAN_KIND_SERVER",status_code="STATUS_CODE_ERROR"}[${rateInterval}])) / sum(rate(traces_spanmetrics_calls_total{${metricsSelector},span_kind="SPAN_KIND_SERVER"}[${rateInterval}]))`;

  const getLatencyQuery = (type: LatencyType) => {
    if (type === 'avg') {
      return `sum(rate(traces_spanmetrics_latency_sum{${metricsSelector},span_kind="SPAN_KIND_SERVER"}[${rateInterval}])) / sum(rate(traces_spanmetrics_latency_count{${metricsSelector},span_kind="SPAN_KIND_SERVER"}[${rateInterval}]))`;
    }
    const quantile = type === 'p99' ? '0.99' : '0.95';
    return `histogram_quantile(${quantile}, sum(rate(traces_spanmetrics_latency_bucket{${metricsSelector},span_kind="SPAN_KIND_SERVER"}[${rateInterval}])) by (le))`;
  };

  const latencyQuery = getLatencyQuery(latencyType);

  const { value: requestRateData, loading: loadingRequestRate, error: errorRequestRate } = useAsync(
    async () => await grafanaApi.queryMetrics(requestRateQuery, timeRange, stepInterval),
    [requestRateQuery, timeRange, stepInterval, refreshKey]
  );

  const { value: errorRateData, loading: loadingErrorRate, error: errorErrorRate } = useAsync(
    async () => await grafanaApi.queryMetrics(errorRateQuery, timeRange, stepInterval),
    [errorRateQuery, timeRange, stepInterval, refreshKey]
  );

  const { value: latencyData, loading: loadingLatency, error: errorLatency } = useAsync(
    async () => await grafanaApi.queryMetrics(latencyQuery, timeRange, stepInterval),
    [latencyQuery, timeRange, stepInterval, latencyType, refreshKey]
  );

  const loading = loadingRequestRate || loadingErrorRate || loadingLatency;
  const error = errorRequestRate || errorErrorRate || errorLatency;

  if (loading) {
    return <Progress />;
  }

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  return (
    <Box className={classes.chartContainer}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle2" color="textSecondary">
              Duration
            </Typography>
            <FormControl size="small">
              <Select
                value={latencyType}
                onChange={(e) => setLatencyType(e.target.value as LatencyType)}
                variant="outlined"
                style={{ fontSize: '0.875rem', height: '28px' }}
              >
                <MenuItem value="p95">P95</MenuItem>
                <MenuItem value="p99">P99</MenuItem>
                <MenuItem value="avg">Avg</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <MetricChartJS
            title=""
            data={latencyData || []}
            unit="ms"
            color="#5794F2"
            timeRangeOption={timeRangeOption}
            timeRange={timeRange}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricChartJS
            title="Errors"
            data={errorRateData || []}
            unit="%"
            color="#F2495C"
            timeRangeOption={timeRangeOption}
            timeRange={timeRange}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <MetricChartJS
            title="Rate"
            data={requestRateData || []}
            unit="req/s"
            color="#73BF69"
            timeRangeOption={timeRangeOption}
            timeRange={timeRange}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export type MetricsCardOpts = {
  title?: string;
  onTimeRangeChange?: (timeRange: TimeRange) => void;
};

type LatencyType = 'p95' | 'p99' | 'avg';

export const MetricsCard = (opts?: MetricsCardOpts) => {
  const classes = useStyles();
  const { entity } = useEntity();
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('1h');
  const [latencyType, setLatencyType] = useState<LatencyType>('p95');
  const [autoRefresh, _setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Update refreshKey when time range changes
  useEffect(() => {
    setRefreshKey(prev => prev + 1);
  }, [timeRange]);

  // Notify parent component of time range changes
  useEffect(() => {
    if (opts?.onTimeRangeChange) {
      const selectedTimeRange: TimeRange = {
        from: TIME_RANGE_OPTIONS[timeRange].from,
        to: 'now',
      };
      opts.onTimeRangeChange(selectedTimeRange);
    }
  }, [timeRange, opts]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setRefreshKey(prev => prev + 1);
    }, 60000); // Refresh every 60 seconds (1 minute)

    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (!isMetricsSelectorAvailable(entity)) {
    return <MissingAnnotationEmptyState annotation={GRAFANA_ANNOTATION_METRICS_SELECTOR} />;
  }

  const selectedTimeRange: TimeRange = {
    from: TIME_RANGE_OPTIONS[timeRange].from,
    to: 'now',
  };

  return (
    <Card className={classes.card}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{opts?.title || 'Service Metrics (RED)'}</Typography>
          <ButtonGroup size="small" className={classes.timeRangeSelector}>
            {(Object.keys(TIME_RANGE_OPTIONS) as TimeRangeOption[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? 'contained' : 'outlined'}
                onClick={() => setTimeRange(range)}
              >
                {TIME_RANGE_OPTIONS[range].label}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
        <Metrics entity={entity} timeRange={selectedTimeRange} timeRangeOption={timeRange} latencyType={latencyType} setLatencyType={setLatencyType} refreshKey={refreshKey} />
      </CardContent>
    </Card>
  );
};
