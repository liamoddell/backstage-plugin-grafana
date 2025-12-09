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
import { Line } from 'react-chartjs-2';
import { Box, Typography } from '@material-ui/core';
import { format } from 'date-fns';
import { TimeSeries, TimeRange } from '../../types';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale,
  ChartOptions,
} from 'chart.js';
import 'chartjs-adapter-date-fns';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  TimeScale
);

type TimeRangeOption = '1h' | '6h' | '24h' | '7d';

interface MetricChartProps {
  title: string;
  data: TimeSeries[];
  unit?: string;
  color?: string;
  timeRangeOption: TimeRangeOption;
  timeRange: TimeRange;
}

export const MetricChartJS = ({ title, data, unit = '', color = '#8884d8', timeRangeOption, timeRange }: MetricChartProps) => {
  // Calculate the actual requested time range for X-axis domain
  const now = Date.now();
  const parseTimeToMs = (timeStr: string): number => {
    if (timeStr === 'now') {
      return now;
    }
    const match = timeStr.match(/^now-(\d+)([smhd])$/);
    if (!match) {
      return now;
    }
    const value = parseInt(match[1], 10);
    const unitChar = match[2];
    const msMultipliers: Record<string, number> = {
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
    };
    return now - (value * msMultipliers[unitChar]);
  };

  const xAxisMin = parseTimeToMs(timeRange.from);
  const xAxisMax = parseTimeToMs(timeRange.to);

  // Prepare chart data with boundary points to force full range
  const dataPoints = data[0]?.datapoints.map(dp => ({
    x: dp.timestamp,
    y: dp.value,
  })) || [];

  // Don't add boundary points - let Chart.js handle the range with min/max settings
  const chartDataWithBoundaries = dataPoints;

  const chartData = {
    datasets: [
      {
        label: title,
        data: chartDataWithBoundaries,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        hitRadius: 10,
        tension: 0.1,
        spanGaps: true,
      },
    ],
  };

  const formatValue = (value: number): string => {
    if (unit === '%') {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (unit === 'ms') {
      const ms = value * 1000;
      if (ms < 1) {
        return `${ms.toFixed(2)} ms`;
      }
      return `${ms.toFixed(0)} ms`;
    }
    if (unit === 'req/s') {
      return `${value.toFixed(2)} req/s`;
    }
    return value.toFixed(2);
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return formatValue(context.parsed.y);
          },
          title: (tooltipItems) => {
            return format(tooltipItems[0].parsed.x, 'MMM dd, HH:mm:ss');
          },
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
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        ticks: {
          font: {
            size: 12,
          },
          color: 'rgba(255, 255, 255, 0.7)',
          maxRotation: 0,
          autoSkipPadding: 20,
        },
      },
      y: {
        beginAtZero: false,
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        ticks: {
          font: {
            size: 12,
          },
          color: 'rgba(255, 255, 255, 0.7)',
          callback: (value) => {
            return formatValue(Number(value));
          },
        },
      },
    },
  };

  return (
    <Box>
      <Typography variant="subtitle2" color="textSecondary">
        {title}
      </Typography>
      {!data || data.length === 0 || data[0]?.datapoints.length === 0 ? (
        <Typography variant="body2" color="textSecondary">
          No data available
        </Typography>
      ) : (
        <Box height={200}>
          <Line data={chartData} options={options} />
        </Box>
      )}
    </Box>
  );
};
